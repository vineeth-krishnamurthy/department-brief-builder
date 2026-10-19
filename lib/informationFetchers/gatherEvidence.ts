import { grantFacts } from "./fetchGrants";
import { fetchDeptPages } from "./fetchDeptWebsites";
import { nonprofitFacts } from "./fetchNonprofitFinances";
import { searchResults, type SearchProvider } from "./fetchSearchResults";
import { meetingDocs } from "./fetchMeetingDocs";
import { socialLinks, type SocialLink } from "./fetchSocial";
import { findApparatus, apparatusFacts, type Apparatus } from "../extractors/apparatusAge";
import { registryFacts } from "../validators/fireDepartmentValidator";
import type { Progress } from "../brief/progress";
import type { Doc } from "./crawler";
import type { Fact, Place, RegistryEntry } from "../utils/dataTypes";

/** Everything the deterministic layer found for one department, before Claude sees it. */
export type Evidence = {
  place: Place;
  registry: RegistryEntry | null;
  website: string;
  grants: Fact[] | null;
  nonprofit: Fact[] | null;
  search: { provider: SearchProvider; urls: string[] } | null; // null = no search provider could run
  pages: Doc[];
  meetings: Doc[] | null;
  apparatus: Apparatus[];
  social: SocialLink[];
  knownFacts: Fact[];
};

const count = (v: unknown[] | null, one: string, many = `${one}s`) =>
  v === null ? { status: "failed" as const, detail: "lookup failed" } : { detail: v.length ? `${v.length} ${v.length === 1 ? one : many}` : "nothing found" };

/** Run every fetcher in parallel, reporting each one's progress as it finishes. */
export async function gatherEvidence(place: Place, registry: RegistryEntry | null, progress: Progress): Promise<Evidence> {
  const website = place.website || registry?.website || "";
  // Web search first: its results seed the crawl and the council-records check. The grant,
  // and 990 lookups run alongside it.
  const searched = progress.track("search", searchResults(place).catch(() => null), (v) =>
    v === null ? { status: "failed", detail: "no search provider" } : { detail: `${v.results.length} results (${v.provider === "serper" ? "Google via Serper" : "Claude web search"})` },
  );
  const searchThenCrawl = (async () => {
    const found = await searched;
    const urls = found?.results.map((r) => r.url) ?? [];
    const pages = await progress.track(
      "site",
      fetchDeptPages(website, urls, place, (n) => progress.partial("site", n / 30, `${n} pages read`)).catch(() => []),
      (v) => ({ detail: v.length ? `${v.length} documents` : website || urls.length ? "nothing usable" : "no website or search results" }),
    );
    return { search: found ? { provider: found.provider, urls } : null, pages };
  })();

  const [grants, nonprofit, { search, pages }, meetings] = await Promise.all([
    progress.track("grants", grantFacts(place).catch(() => null), (v) => count(v, "award")),
    progress.track("nonprofit", nonprofitFacts(place).catch(() => null), (v) => (v === null ? count(v, "") : { detail: v.length ? "filings found" : "no matching nonprofit" })),
    searchThenCrawl,
    searched.then((found) => {
      const hosts = [website, ...(found?.results.map((r) => r.url) ?? [])].flatMap((u) => {
        try {
          return u ? [new URL(u).host] : [];
        } catch {
          return [];
        }
      });
      return progress.track("meetings", meetingDocs(place, [...new Set(hosts)].slice(0, 6)).catch(() => null), (v) => ({
        detail: v === null ? "no agenda platform found" : v.length ? `${v.length} items` : "nothing about the fire department",
      }));
    }),
  ]);

  const apparatus = findApparatus([...pages, ...(meetings ?? [])]);
  // Social links only from the department's own site; search-result pages link to their own accounts.
  const deptHost = website ? website.replace(/^https?:\/\/(www\.)?/, "").split("/")[0].toLowerCase() : "";
  const social = socialLinks(pages.filter((p) => !!deptHost && p.url.replace(/^https?:\/\/(www\.)?/, "").toLowerCase().startsWith(deptHost)));
  const knownFacts = [
    ...(registry ? registryFacts(registry) : []),
    ...(grants ?? []),
    ...(nonprofit ?? []),
    ...apparatusFacts(apparatus),
  ];
  return { place, registry, website, grants, nonprofit, search, pages, meetings, apparatus, social, knownFacts };
}
