import { crawl, bareHost, type Doc } from "../utils/crawler";

/**
 * Crawl the department's website, and the parent city or county site when the
 * department lives under it, following links about leadership, fleet, money, and governance.
 * Returns documents (HTML pages and PDFs) as plain text for Claude to read.
 */
export type Page = Doc;

export const SITE_KEYWORDS =
  /apparatus|fleet|equipment|vehicle|engine|truck|ladder|chief|officer|staff|leadership|personnel|administration|about|history|budget|finance|financ|capital|annual[- ]?report|grant|fund|news|press|announce|agenda|minutes|board|commission|council|trustee|meeting|transparency|public[- ]?records|document|report|plan/i;

export async function fetchDeptPages(website: string, onDoc?: (count: number) => void): Promise<Page[]> {
  if (!website) return [];
  const starts = [website];

  // A department page under a city or county domain (e.g. /Agencies/fire/) means the
  // parent government's site holds the budget, agendas, and minutes. Crawl it too.
  try {
    const u = new URL(website);
    if (u.pathname.replace(/\/$/, "").length > 1 && !/^(fire|fd)\./i.test(u.hostname)) starts.push(`${u.protocol}//${u.host}/`);
  } catch {
    return [];
  }

  const docs = await crawl({ starts, keywords: SITE_KEYWORDS, deadlineMs: 9000, maxDocs: 24, maxPdfs: 4, maxDepth: 2, onDoc });

  // Keep the department's own pages first, then the parent site's most relevant documents.
  const deptHost = bareHost(new URL(website).hostname);
  const score = (d: Doc) => (bareHost(new URL(d.url).hostname) === deptHost ? 100 : 0) + relevance(d) - d.depth;
  return docs
    .filter((d) => d.text.length > 200)
    .sort((a, b) => score(b) - score(a))
    .slice(0, 18);
}

/** How many fire-service and money words a document contains, capped so one page can't dominate. */
function relevance(d: Doc) {
  const hits = d.text.match(/\b(fire|apparatus|engine|ladder|pumper|chief|budget|grant|capital|purchase|replacement|bid|award)\b/gi)?.length ?? 0;
  return Math.min(50, hits);
}
