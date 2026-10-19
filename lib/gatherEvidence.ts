import { grantFacts } from "./informationFetchers/fetchGrants";
import { fetchDeptPages } from "./informationFetchers/fetchDeptWebsites";
import { nonprofitFacts } from "./informationFetchers/fetchNonprofitFinances";
import { newsHeadlines, type Headline } from "./informationFetchers/fetchNews";
import { surplusFacts } from "./informationFetchers/fetchSurplus";
import { meetingDocs } from "./informationFetchers/fetchMeetingDocs";
import { socialLinks, type SocialLink } from "./informationFetchers/fetchSocial";
import { findApparatus, apparatusFacts, type Apparatus } from "./utils/apparatusAge";
import { registryFacts } from "./validators/fireDepartmentValidator";
import type { Progress } from "./utils/progress";
import type { Doc } from "./utils/crawler";
import type { Fact, Place, RegistryEntry } from "./utils/dataTypes";

/** Everything the deterministic layer found for one department, before Claude sees it. */
export type Evidence = {
  place: Place;
  registry: RegistryEntry | null;
  website: string;
  grants: Fact[] | null;
  nonprofit: Fact[] | null;
  news: Headline[] | null;
  surplus: Fact[] | null;
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
  const hosts = website ? [new URL(website).host] : [];

  const [grants, nonprofit, news, surplus, pages, meetings] = await Promise.all([
    progress.track("grants", grantFacts(place).catch(() => null), (v) => count(v, "award")),
    progress.track("nonprofit", nonprofitFacts(place).catch(() => null), (v) => (v === null ? count(v, "") : { detail: v.length ? "filings found" : "no matching nonprofit" })),
    progress.track("news", newsHeadlines(place).catch(() => null), (v) => count(v, "story", "stories")),
    progress.track("surplus", surplusFacts(place).catch(() => null), (v) => count(v, "listing")),
    progress.track(
      "site",
      fetchDeptPages(website, (n) => progress.partial("site", n / 24, `${n} pages read`)).catch(() => []),
      (v) => ({ detail: website ? (v.length ? `${v.length} documents` : "site unreachable") : "no website" }),
    ),
    progress.track("meetings", meetingDocs(place, hosts).catch(() => null), (v) => ({ detail: v === null ? "no agenda platform found" : v.length ? `${v.length} items` : "nothing about the fire department" })),
  ]);

  const apparatus = findApparatus([...pages, ...(meetings ?? [])]);
  const social = socialLinks(pages);
  const knownFacts = [
    ...(registry ? registryFacts(registry) : []),
    ...(grants ?? []),
    ...(nonprofit ?? []),
    ...apparatusFacts(apparatus),
    ...(surplus ?? []),
  ];
  return { place, registry, website, grants, nonprofit, news, surplus, pages, meetings, apparatus, social, knownFacts };
}
