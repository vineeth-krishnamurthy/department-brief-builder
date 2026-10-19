import { crawl, bareHost, type Doc } from "../utils/crawler";

/**
 * Crawl the department's website, the parent city or county site when the department lives
 * under it, and the first page of web search results for the department, following links about
 * leadership, fleet, money, and governance. Returns documents (HTML pages and PDFs) as text.
 */
export type Page = Doc;

export const SITE_KEYWORDS =
  /apparatus|fleet|equipment|vehicle|engine|truck|tanker|ladder|chief|officer|staff|leadership|personnel|directory|administration|about|history|budget|finance|financ|capital|annual[- ]?report|town[- ]?report|grant|fund|bid|surplus|news|press|announce|agenda|minutes|board|selectboard|commission|council|trustee|meeting|transparency|public[- ]?records|document|report|plan/i;

export async function fetchDeptPages(
  website: string,
  searchUrls: string[],
  place: { name: string; city: string; state: string },
  onDoc?: (count: number) => void,
): Promise<Page[]> {
  // The department's own site (and its parent government site) is crawled two levels deep;
  // search results start one level down, so their keyword links are followed once.
  const starts: { url: string; depth: number }[] = [];
  if (website) {
    try {
      const u = new URL(website);
      starts.push({ url: website, depth: 0 });
      // A department page under a city or county domain (e.g. /Agencies/fire/) means the
      // parent government's site holds the budget, agendas, and minutes. Crawl it too.
      if (u.pathname.replace(/\/$/, "").length > 1 && !/^(fire|fd)\./i.test(u.hostname)) starts.push({ url: `${u.protocol}//${u.host}/`, depth: 0 });
    } catch {}
  }
  // Official-looking results (a .gov/.us site, or a domain containing the town's name, like
  // washingtonvt.org) get one level of links followed. Third-party sites (directories,
  // aggregators, Wikipedia) are read but not followed, so they can't flood the crawl.
  const townToken = place.city.toLowerCase().replace(/[^a-z]/g, "");
  const official = (url: string) => {
    const h = safeBareHost(url);
    return /\.(gov|us)$/.test(h) || (townToken.length > 3 && h.replace(/[^a-z]/g, "").includes(townToken));
  };
  for (const url of searchUrls) if (!starts.some((s) => s.url === url)) starts.push({ url, depth: official(url) ? 1 : 2 });
  if (!starts.length) return [];

  const docs = await crawl({ starts, keywords: SITE_KEYWORDS, deadlineMs: 9000, maxDocs: 30, maxPdfs: 4, maxDepth: 2, onDoc });

  // Search results can be about a different department with the same name. Keep a page only if
  // it is on the department's own site, or mentions both its town and its state.
  const deptHost = website ? safeBareHost(website) : "";
  const town = place.city.toLowerCase();
  const stateName = STATES[place.state.toUpperCase()]?.toLowerCase();
  const onDeptSite = (d: Doc) => !!deptHost && safeBareHost(d.url) === deptHost;
  const aboutTown = (d: Doc) => {
    const t = d.text.toLowerCase();
    const inState = new RegExp(`\\b${place.state.toLowerCase()}\\b`).test(t) || (!!stateName && t.includes(stateName));
    return !!town && t.includes(town) && inState;
  };
  const score = (d: Doc) => (onDeptSite(d) ? 100 : 0) + relevance(d) - d.depth;
  return docs
    .filter((d) => d.text.length > 200 && (onDeptSite(d) || aboutTown(d)))
    .sort((a, b) => score(b) - score(a))
    .slice(0, 20);
}

const safeBareHost = (url: string) => {
  try {
    return bareHost(new URL(url).hostname);
  } catch {
    return "";
  }
};

/** How many fire-service and money words a document contains, capped so one page can't dominate. */
function relevance(d: Doc) {
  const hits = d.text.match(/\b(fire|apparatus|engine|ladder|pumper|chief|budget|grant|capital|purchase|replacement|bid|award)\b/gi)?.length ?? 0;
  return Math.min(50, hits);
}

const STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
};
