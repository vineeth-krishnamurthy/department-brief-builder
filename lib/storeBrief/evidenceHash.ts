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
 * Only pages that matter to the brief are fingerprinted (see matters()). The crawl is timed, so on
 * a large city site each run reaches a different mix of council calendars and arts-grant pages;
 * counting those would make every run look new.
 */
export function evidenceHash(e: Evidence): string {
  const docs = [...e.pages.filter((d) => matters(d, e.website)), ...(e.meetings ?? [])];
  const canonical = {
    v: 4, // bump when the hashing rules change, so old versions aren't wrongly matched
    place: [e.place.name, e.place.address, e.place.phone, e.place.website],
    registry: e.registry,
    grants: e.grants === null ? "failed" : e.grants.map((f) => f.text).sort(),
    nonprofit: e.nonprofit === null ? "failed" : e.nonprofit.map((f) => f.text).sort(),
    meetings: e.meetings === null ? "none" : "found",
    docs: docFingerprints(docs),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/**
 * A page counts toward the hash if it is on the department's own site (a site at its own domain,
 * like wavfc.org, not a page under a city site), or if its address or title is about the fire
 * service or its apparatus.
 */
// Not "chief", "truck", "auction", or "bids" alone: on a city site those are police chiefs, food trucks,
// license auctions, and road-work bids.
const ABOUT_FIRE = /\b(fire|apparatus|fleet|engines?|tankers?|pumpers?|ladders?|surplus)\b/i;
function matters(d: { url: string; title: string }, website: string): boolean {
  if (website) {
    try {
      const own = new URL(website);
      if (own.pathname.replace(/\/$/, "") === "" && hostOf(d.url) === hostOf(website)) return true;
    } catch {}
  }
  let path = d.url;
  try {
    path = decodeURIComponent(new URL(d.url).pathname);
  } catch {}
  return ABOUT_FIRE.test(`${path.replace(/[/_.-]+/g, " ")} ${d.title}`);
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
