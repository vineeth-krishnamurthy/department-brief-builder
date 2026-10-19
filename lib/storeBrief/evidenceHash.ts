import { createHash } from "node:crypto";
import type { Evidence } from "../gatherInformation/gatherEvidence";

/**
 * A fingerprint of everything the fetchers gathered for one department. Two runs with the same
 * hash saw the same information, so writing a new brief would be pointless.
 *
 * Page text is fingerprinted with boilerplate removed: any 8-word run that appears on at least
 * half the pages of the same site (menus, footers, "recent posts" sidebars) is ignored, so a
 * changed copyright year or a reordered menu doesn't count as new information. Duplicate pages
 * reached through different URLs collapse to one fingerprint.
 *
 * Only the starting pages are fingerprinted: the department's website and its parent city or
 * county site, which come from Google Places or the registry and are read first on every run. A
 * department with no website uses its official search results (a .gov/.us site or one named for
 * the town) instead. Pages reached by following links, sitemap pages, and other search results are
 * left out: the crawl is timed and Google varies its results, so each run reaches a different mix
 * and every run would look new. News and notices usually appear on a starting page (a home page or
 * notices list), so new information still changes the hash.
 */
export function evidenceHash(e: Evidence): string {
  // The crawl starts the department and parent site at depth 0 and official search results at depth 1.
  const startDepth = e.website ? 0 : 1;
  const docs = [...e.pages.filter((d) => d.start && d.depth <= startDepth), ...(e.meetings ?? [])];
  const canonical = {
    v: 5, // bump when the hashing rules change, so old versions aren't wrongly matched
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
