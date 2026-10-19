import { crawl, sitemapUrls, bareHost, type Doc } from "./crawler";
import { findApparatus } from "../utils/apparatusAge";

/**
 * Crawl the department's website, the parent city or county site when the department lives
 * under it, and the first page of web search results for the department. Official sites also
 * contribute the high-value pages listed in their sitemaps (bid notices, vehicles for sale,
 * apparatus, budgets), which are often linked from nowhere once they age off a list.
 * Links are fetched best-first. Returns documents (HTML pages and PDFs) as text.
 */
export type Page = Doc;

export const SITE_KEYWORDS =
  /apparatus|fleet|equipment|vehicle|engine|truck|tanker|ladder|chief|officer|staff|leadership|personnel|directory|administration|about|history|budget|finance|financ|capital|annual[- ]?report|town[- ]?report|grant|fund|bid|surplus|news|press|announce|agenda|minutes|board|selectboard|commission|council|trustee|meeting|transparency|public[- ]?records|document|report|plan/i;

/**
 * How valuable a link looks for Garage, from its URL and link text:
 *   3: vehicles and their sale (tanker, engine, truck, apparatus, surplus, for sale, auction)
 *   2: leadership, the fire department, and money (chief, directory, budget, grants, minutes)
 *   1: anything else the keyword list follows, including generic bids and RFPs, which on a
 *      town site are mostly roads and bridges
 */
const HIGH = /\b(surplus|for[- ]sale|sold|auctions?|tankers?|pumpers?|engines?|ladders?|aerials?|apparatus|fire[- ]?trucks?|trucks?|fleet|vehicles?)\b/i;
const MED = /\b(fire|chief|officers?|officials|directory|roster|budgets?|capital|grants?|warrant|town[- ]?report|annual[- ]?report|minutes|agendas?|selectboard|council)\b/i;
export function linkPriority(url: string, text: string): number {
  let path = url;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {}
  const s = `${path.replace(/[/_.-]+/g, " ")} ${text}`;
  return HIGH.test(s) ? 3 : MED.test(s) ? 2 : SITE_KEYWORDS.test(s) ? 1 : 0;
}

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
  // A domain naming a different state ("washington.nh.gov" for Washington, VT) isn't official.
  const townToken = place.city.toLowerCase().replace(/[^a-z]/g, "");
  const state = place.state.toLowerCase();
  const official = (url: string) => {
    const h = safeBareHost(url);
    const labels = h.split(/[.-]/);
    if (labels.some((l) => l.length === 2 && STATES[l.toUpperCase()] && l !== state && l !== "us")) return false;
    return /\.(gov|us)$/.test(h) || (townToken.length > 3 && h.replace(/[^a-z]/g, "").includes(townToken));
  };
  for (const url of searchUrls) if (!starts.some((s) => s.url === url)) starts.push({ url, depth: official(url) ? 1 : 2 });
  if (!starts.length) return [];

  // Sitemaps of the department's own site and official result sites: add their best pages
  // directly (read, not followed), ranked so bids and vehicle sales come first.
  const deadline = Date.now() + 15_000;
  const origins = [...new Set(starts.filter((s) => s.depth < 2).map((s) => originOf(s.url)).filter(Boolean))].slice(0, 4);
  const listed = (await Promise.all(origins.map((o) => sitemapUrls(o, Math.min(deadline, Date.now() + 4000))))).flat();
  const fromSitemaps = listed
    .map((url) => ({ url, score: linkPriority(url, "") }))
    .filter((x) => x.score >= 2 && !starts.some((s) => s.url === x.url))
    .sort((a, b) => b.score - a.score)
    .slice(0, 25)
    .map((x) => ({ url: x.url, depth: 2, score: 50 + x.score }));

  const docs = await crawl({
    starts: [...starts.map((s) => ({ ...s, score: 100 })), ...fromSitemaps],
    keywords: SITE_KEYWORDS,
    priority: linkPriority,
    deadlineMs: Math.max(3000, deadline - Date.now()),
    maxDocs: 50,
    maxPdfs: 6,
    maxDepth: 2,
    onDoc,
  });

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
    .slice(0, 30);
}

const originOf = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
};

const safeBareHost = (url: string) => {
  try {
    return bareHost(new URL(url).hostname);
  } catch {
    return "";
  }
};

/**
 * How useful a document looks: fire-service and money words, capped so one page can't dominate,
 * plus a large bonus for anything about selling or buying vehicles, which matters most to Garage.
 */
function relevance(d: Doc) {
  const hits = d.text.match(/\b(fire|apparatus|engine|ladder|pumper|tanker|chief|budget|grant|capital|purchase|replacement)\b/gi)?.length ?? 0;
  // A sale counts only when a vehicle is being sold; a bid for road work isn't a lead for Garage.
  const vehicle = /\b(tankers?|pumpers?|fire (engine|truck)s?|trucks?|apparatus|ambulances?|vehicles?)\b/i.test(d.text);
  const selling = vehicle && /\b(request for bids|sealed bids|for sale|surplus|auction|minimum bid)\b/i.test(d.text) ? 40 : 0;
  // Pages that name the chief (directories, officer lists) answer the Leadership question.
  const namesChief = /\b(Fire\s+)?Chief:?\s+[A-Z][a-z]+\s+[A-Z][a-zA-Z'-]+|[A-Z][a-z]+\s+[A-Z][a-zA-Z'-]+,?\s+(Fire\s+)?Chief\b/.test(d.text) ? 30 : 0;
  // Pages listing dated apparatus (rosters, fleet pages) are the fleet answer, however short.
  const fleetData = Math.min(60, 15 * findApparatus([d]).length);
  return Math.min(50, hits) + selling + namesChief + fleetData + 10 * linkPriority(d.url, d.title);
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
