import { createHash } from "node:crypto";
import type { Evidence } from "../informationFetchers/gatherEvidence";

/**
 * A fingerprint of everything the fetchers gathered for one department. Two runs with the same
 * hash saw the same information, so writing a new brief would be pointless.
 *
 * Page text is fingerprinted with boilerplate removed: any 8-word run that appears on at least
 * half the pages of the same site (menus, footers, "recent posts" sidebars) is ignored, so a
 * changed copyright year or a reordered menu doesn't count as new information. Duplicate pages
 * reached through different URLs collapse to one fingerprint.
 */
export function evidenceHash(e: Evidence): string {
  const docs = [...e.pages, ...(e.meetings ?? [])];
  const canonical = {
    v: 3, // bump when the hashing rules change, so old versions aren't wrongly matched
    place: [e.place.name, e.place.address, e.place.phone, e.place.website],
    registry: e.registry,
    grants: e.grants === null ? "failed" : e.grants.map((f) => f.text).sort(),
    nonprofit: e.nonprofit === null ? "failed" : e.nonprofit.map((f) => f.text).sort(),
    meetings: e.meetings === null ? "none" : "found",
    docs: docFingerprints(docs),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

const SHINGLE = 8;

function docFingerprints(docs: { url: string; text: string }[]): string[] {
  const byHost = new Map<string, Set<string>[]>();
  const shingles = docs.map((d) => {
    const words = d.text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
    const set = new Set<string>();
    for (let i = 0; i + SHINGLE <= words.length; i++) set.add(words.slice(i, i + SHINGLE).join(" "));
    if (words.length && words.length < SHINGLE) set.add(words.join(" "));
    const host = hostOf(d.url);
    byHost.set(host, [...(byHost.get(host) ?? []), set]);
    return { host, set };
  });

  // Boilerplate: shingles shared by at least half the pages of a site (needs 2+ pages).
  const boilerplate = new Map<string, Set<string>>();
  for (const [host, sets] of byHost) {
    const counts = new Map<string, number>();
    for (const s of sets) for (const sh of s) counts.set(sh, (counts.get(sh) ?? 0) + 1);
    const min = Math.max(2, Math.ceil(sets.length / 2));
    boilerplate.set(host, new Set(sets.length >= 2 ? [...counts].filter(([, n]) => n >= min).map(([sh]) => sh) : []));
  }

  const prints = shingles
    .map(({ host, set }) => [...set].filter((sh) => !boilerplate.get(host)!.has(sh)).sort())
    .filter((content) => content.length > 0)
    .map((content) => createHash("sha1").update(content.join("\n")).digest("hex"));
  return [...new Set(prints)].sort();
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
