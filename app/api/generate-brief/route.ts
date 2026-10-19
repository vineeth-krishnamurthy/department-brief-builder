import { NextResponse } from "next/server";
import { validateFireDepartment, findRegistryEntry, registryDate, validatePlaceId } from "@/lib/validators/inputValidator";
import { getPlace } from "@/lib/gatherInformation/fetchGooglePlaceId";
import { gatherEvidence } from "@/lib/gatherInformation/gatherEvidence";
import { buildFireDeptBrief } from "@/lib/buildFireDeptBrief";
import { MODEL } from "@/lib/writeBrief/writeWithClaude";
import { evidenceHash } from "@/lib/storeBrief/evidenceHash";
import { latestVersion, saveVersion, storeConfigured, touchDepartment, versionWithHash, type StoredVersion } from "@/lib/storeBrief/briefStore";
import { acquireSlot, BusyError } from "@/lib/utils/rateLimiter";
import { Progress } from "@/lib/utils/progress";
import type { Brief, BriefEvent } from "@/lib/utils/dataTypes";

export const maxDuration = 90; // target is under 60s per brief; headroom so a slow run finishes instead of being cut off

/**
 * Streams newline-delimited JSON events so the page can show live progress:
 *   { type: "progress", pct, steps }   many times
 * then exactly one of:
 *   { type: "result", brief }                         a new brief, saved as the next version
 *   { type: "unchanged", message, brief }             same evidence as the latest stored version
 *   { type: "rejected", reason, place }               not a government fire department
 *   { type: "error", message }
 * Bad input (400) and a full service (429) are answered as plain JSON before streaming starts.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { placeId?: unknown };
  const placeId = validatePlaceId(body.placeId);
  if (!placeId) {
    return NextResponse.json(
      { error: "That doesn't look like a Google Place ID. They are 10 to 300 letters, digits, dashes, or underscores, usually starting with \"ChIJ\"." },
      { status: 400 },
    );
  }

  let release: () => Promise<void>;
  try {
    release = await acquireSlot();
  } catch (e) {
    if (e instanceof BusyError) return NextResponse.json({ error: e.message }, { status: 429, headers: { "Retry-After": "5" } });
    throw e;
  }

  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: BriefEvent) => {
        if (open) controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      };
      try {
        send(await research(placeId, new Progress(send)));
      } catch (e) {
        const status = (e as { status?: number }).status;
        const message = e instanceof Error ? e.message : String(e);
        console.error("brief failed:", message);
        send({ type: "error", message: status === 404 ? message : `Something went wrong while researching this department: ${message}` });
      } finally {
        await release();
        if (open) controller.close();
        open = false;
      }
    },
    async cancel() {
      // The browser went away: stop sending and free the slot (the release is idempotent).
      open = false;
      await release();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}

async function research(placeId: string, progress: Progress): Promise<BriefEvent> {
  const started = Date.now();

  // 1. Resolve the place.
  const place = await progress.track("place", getPlace(placeId), (p) => ({ detail: p.name }));

  // 2. Gate on the USFA registry, then on Google types and domain.
  progress.start("gate");
  const registry = findRegistryEntry(place);
  const reason = validateFireDepartment(place, registry);
  if (reason) {
    progress.fail("gate", "not a government fire department");
    progress.skipRemaining("stopped");
    return { type: "rejected", reason, place };
  }
  progress.done("gate", registry ? `USFA registry FDID ${registry.fdid}` : "passed on place type and website");

  // 3. Every deterministic source in parallel.
  const evidence = await gatherEvidence(place, registry, progress);

  // 4. Compare with every stored version. Evidence already seen means a new brief would add nothing.
  const hash = evidenceHash(evidence);
  let previous: StoredVersion | null = null;
  if (storeConfigured()) {
    progress.start("compare");
    const failed = (e: Error) => {
      console.error("stored brief lookup failed:", e.message);
      return null;
    };
    previous = await latestVersion(place.id).catch(failed);
    const match = previous && previous.evidence_hash === hash ? previous : previous ? await versionWithHash(place.id, hash).catch(failed) : null;
    if (match) {
      await touchDepartment(place.id).catch(() => {});
      progress.done("compare", `matches version ${match.version}`);
      progress.skipRemaining("not needed: nothing changed");
      const when = new Date(match.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const since = match.version === previous!.version ? `Nothing new since version ${match.version} on ${when}.` : `Same information as version ${match.version} from ${when}.`;
      return {
        type: "unchanged",
        message: `${since} Every source returned the same information, so a new brief wasn't created. Showing that version.`,
        brief: { ...match.brief, storage: { status: "unchanged", version: match.version, saved_at: match.created_at } },
      };
    }
    progress.done("compare", previous ? `changed since version ${previous.version}` : "first brief for this department");
  } else {
    progress.skip("compare", "storage not configured");
  }

  // 5. One Claude call reads all of it and writes the brief.
  progress.start("claude");
  const { sections, why_call_today } = await buildFireDeptBrief(evidence, (fraction, detail) => progress.partial("claude", fraction, detail));
  progress.done("claude", `${sections.reduce((n, s) => n + s.facts.length, 0)} facts`);

  const brief: Brief = {
    place, registry, registry_date: registryDate(), sections, why_call_today,
    elapsed_ms: Date.now() - started, generated_at: new Date().toISOString(),
  };

  // 6. Save as the next version.
  if (!storeConfigured()) {
    progress.skip("save", "storage not configured");
    return { type: "result", brief: { ...brief, storage: { status: "not_saved", reason: "Storage is not configured." } } };
  }
  progress.start("save");
  try {
    const saved = await saveVersion({ place, registry, hash, brief, previous, model: MODEL });
    progress.done("save", `version ${saved.version}`);
    return { type: "result", brief: { ...brief, storage: { status: "new", version: saved.version, saved_at: saved.created_at } } };
  } catch (e) {
    console.error("save failed:", (e as Error).message);
    progress.fail("save", "could not save");
    return { type: "result", brief: { ...brief, storage: { status: "not_saved", reason: "The brief was created but could not be saved." } } };
  }
}
