import known from "@/data/known-domains.json";
import type { Fact, Place, RegistryEntry } from "./utils/dataTypes";
import type { Page } from "./informationFetchers/fetchDeptWebsites";
import type { Memory } from "./utils/cache";
import { fetchFromClaude, type BriefOutput } from "./informationFetchers/fetchFromClaude";

export type ResearchInput = {
  place: Place;
  registry: RegistryEntry | null;
  knownFacts: Fact[]; // from registry + USAspending, already sourced
  grants: Fact[] | null; // null = USAspending lookup failed, [] = checked and found nothing
  website: string; // the site we tried to read ("" = none known)
  pages: Page[]; // department website text
  memory: Memory | null; // URLs that worked last time
  learnedDomains: string[];
};

/**
 * Turn everything the deterministic layer gathered into the two prompts, then ask Claude
 * to write the brief and fill the remaining gaps with a few searches.
 */
export async function buildFireDeptBrief(input: ResearchInput): Promise<BriefOutput> {
  const { place, registry, knownFacts, pages, memory, learnedDomains } = input;
  const { checked, missing } = coverage(input);
  const deptDomain = place.website ? new URL(place.website).hostname.replace(/^www\./, "") : null;
  const preferred = [
    ...known.surplus_sales, ...known.apparatus_news, ...known.council_records, ...learnedDomains,
  ].filter((d, i, a) => a.indexOf(d) === i);

  const system = `You write one-page pre-call briefs for Garage, a marketplace where fire departments sell used apparatus and equipment. The reader is an account executive about to phone this department. Today is ${new Date().toISOString().slice(0, 10)}.

Rules:
- Every fact must carry the URL of the page it came from. Never invent facts or URLs. If you cannot source something, leave it out.
- Prefer concrete, dated, recent facts: names, apparatus makes and years, dollar amounts, award dates, council votes, surplus listings.
- Material you were given is already sourced; reuse it with its source_url. The user message starts with "Sources already checked": do not search again for anything it says is covered, and do not fetch a site it says is unreachable. Spend your searches on the "Still missing" list, in order. At most 3 searches. Good query shapes: "<dept name> fire chief", "<dept name> apparatus", "<city> fire new engine OR pumper OR ladder <year>", "site:govdeals.com <city> fire".
- Prefer these domains when they turn up: ${preferred.join(", ")}${deptDomain ? `, and the department's own site ${deptDomain}` : ""}.
- Keep it to 10 to 18 facts total. One sentence per fact, no filler.

Respond with ONLY a JSON object, no prose, no code fence:
{"sections":[{"title":"Leadership","facts":[{"text":"...","source_url":"https://...","source_title":"..."}]},{"title":"Fleet","facts":[]},{"title":"Budget & Grants","facts":[]},{"title":"Recent News","facts":[]}],"why_call_today":"Two sentences on why this department may be ready to sell or replace apparatus, based only on the facts above."}
Omit a section if it has no facts.`;

  const user = [
    "Sources already checked:",
    ...checked.map((c) => `- ${c}`),
    "",
    `Still missing, search for these: ${missing.join("; ")}.`,
    "",
    `Department: ${place.name}`,
    `Address: ${place.address}`,
    place.phone && `Phone: ${place.phone}`,
    place.website && `Website: ${place.website}`,
    registry && `USFA registry row: ${JSON.stringify(registry)}`,
    "",
    "Already-sourced facts (reuse as-is):",
    ...knownFacts.map((f) => `- ${f.text} [${f.source_title}] ${f.source_url}`),
    "",
    memory?.urls.length
      ? `URLs that produced useful facts last time (fetch them first before searching):\n${memory.urls.map((u) => `- ${u.url} (${u.section})`).join("\n")}`
      : "",
    "",
    ...pages.map((p) => `--- Page: ${p.title}\nURL: ${p.url}\n${p.text}\n`),
  ]
    .filter((l): l is string => typeof l === "string")
    .join("\n");

  return fetchFromClaude(system, user);
}

/**
 * Summarize what the deterministic layer already covered, so Claude doesn't repeat it,
 * and work out which gaps its searches should go to.
 */
export function coverage({ registry, grants, website, pages, memory }: ResearchInput): { checked: string[]; missing: string[] } {
  const checked: string[] = [];
  const host = website ? safeHost(website) : "";

  checked.push(
    registry
      ? `USFA fire department registry: matched (FDID ${registry.fdid}). Department type, station count, and staffing are covered.`
      : "USFA fire department registry: no match. Department type and staffing are unknown; mention them only if a page states them.",
  );

  if (grants === null) checked.push("USAspending federal fire grants: lookup failed. One search for recent AFG or SAFER awards is allowed.");
  else if (grants.length === 0) checked.push("USAspending federal fire grants (AFG, SAFER, Fire Prevention & Safety, 2017 onward): checked, none found. Do not search for federal grants.");
  else checked.push(`USAspending federal fire grants: ${grants.length} award${grants.length === 1 ? "" : "s"} found, listed below. Do not search for federal grants.`);

  if (!website) checked.push("Department website: none known.");
  else if (pages.length === 0) checked.push(`Department website ${host}: unreachable. Do not fetch it; use other sources.`);
  else checked.push(`Department website ${host}: read ${pages.length} page${pages.length === 1 ? "" : "s"}, text below.`);

  if (memory?.urls.length) checked.push(`Learned sources from a previous run: ${memory.urls.length} URL${memory.urls.length === 1 ? "" : "s"}, listed below.`);

  // Cheap keyword checks on the pages we already have.
  const text = pages.map((p) => p.text).join(" ");
  const missing: string[] = [];
  if (!/\bchief\s+[A-Z][a-z]+\s+[A-Z][a-z]+/.test(text) && !/[A-Z][a-z]+\s+[A-Z][a-z]+,?\s+(fire\s+)?chief\b/i.test(text)) {
    missing.push("current fire chief's name");
  }
  if (!/\b(engine|ladder|pumper|tanker|tender|quint|aerial|rescue)\s*\d+/i.test(text)) {
    missing.push("current apparatus (engines, ladders, tankers) and their ages");
  }
  missing.push("planned apparatus purchases, replacements, or surplus sales", "news from the last 12 months");
  return { checked, missing };
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
