import { NextResponse } from "next/server";
import { getPlace } from "@/lib/informationFetchers/fetchGooglePlaceId";
import { validateFireDepartment, findRegistryEntry, registryFacts, registryDate } from "@/lib/validators/fireDepartmentValidator";
import { grantFacts } from "@/lib/informationFetchers/fetchGrants";
import { fetchDeptPages } from "@/lib/informationFetchers/fetchDeptWebsites";
import { getBrief, putBrief, recall, remember } from "@/lib/utils/cache";
import { buildFireDeptBrief } from "@/lib/buildFireDeptBrief";
import { withSlot } from "@/lib/utils/rateLimiter";
import { validatePlaceId } from "@/lib/validators/inputValidator";
import type { Brief, Rejection } from "@/lib/utils/dataTypes";

export const maxDuration = 60;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { placeId?: unknown; refresh?: unknown };

  const placeId = validatePlaceId(body.placeId);
  if (!placeId) {
    return NextResponse.json(
      { error: "That doesn't look like a Google Place ID. They are 10 to 300 letters, digits, dashes, or underscores, usually starting with \"ChIJ\"." },
      { status: 400 },
    );
  }

  // Serve a recent brief unless the user asked for a fresh run.
  if (body.refresh !== true) {
    const cached = await getBrief(placeId).catch(() => null);
    if (cached) return NextResponse.json({ ...cached, cached: true });
  }

  try {
    const brief = await withSlot(() => research(placeId));
    if ("rejected" in brief) return NextResponse.json(brief, { status: 422 });
    await putBrief(brief).catch(() => {});
    return NextResponse.json(brief);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    const message = e instanceof Error ? e.message : String(e);
    if (status === 500) console.error("brief failed:", message);
    return NextResponse.json(
      { error: status === 500 ? "Something went wrong while researching this department. Please try again." : message },
      { status, headers: status === 429 ? { "Retry-After": "5" } : undefined },
    );
  }
}

async function research(placeId: string): Promise<Brief | Rejection> {
  const started = Date.now();

  // 1. Resolve the place.
  const place = await getPlace(placeId);

  // 2. Gate on the USFA registry, then on Google types and domain.
  const registry = findRegistryEntry(place);
  const reason = validateFireDepartment(place, registry);
  if (reason) return { rejected: true, reason, place };

  // 3. Deterministic sources, in parallel.
  const website = place.website || registry?.website || "";
  const [grants, pages, { memory, topDomains }] = await Promise.all([
    grantFacts(place).catch(() => null),
    fetchDeptPages(website),
    recall(place.id).catch(() => ({ memory: null, topDomains: [] })),
  ]);
  const knownFacts = [...(registry ? registryFacts(registry) : []), ...(grants ?? [])];

  // 4. One Claude call to assemble the brief and fill gaps.
  const { sections, why_call_today } = await buildFireDeptBrief({
    place, registry, knownFacts, grants, website, pages, memory, learnedDomains: topDomains,
  });

  // 5. Remember which searched-for URLs produced facts (registry and grants are already deterministic).
  const cited = sections
    .flatMap((s) => s.facts.map((f) => ({ url: f.source_url, section: s.title })))
    .filter((c) => !/usaspending\.gov|usfa\.fema\.gov/.test(c.url))
    .filter((c, i, a) => a.findIndex((x) => x.url === c.url) === i);
  await remember(place.id, cited).catch(() => {});

  return {
    place, registry, registry_date: registryDate(), sections, why_call_today,
    elapsed_ms: Date.now() - started, generated_at: new Date().toISOString(),
  };
}
