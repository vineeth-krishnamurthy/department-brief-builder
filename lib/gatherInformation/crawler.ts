/**
 * Small polite web crawler used by the information fetchers.
 *
 * Starts from one or more URLs, follows same-site links whose URL or link text match
 * the given keywords, reads HTML and PDF documents, and stops at a hard deadline so the
 * whole brief stays fast. Everything returned is untrusted text from the internet.
 */
export type Doc = {
  url: string;
  title: string;
  text: string;
  kind: "html" | "pdf";
  depth: number;
  source_type?: string; // set by fetchers that know better than "website"
  date?: string; // only when the source states it (meeting date, introduction date)
  date_label?: string;
  start?: boolean; // one of the URLs the crawl started from, not a page reached by a link
};


export type CrawlOptions = {
  starts: (string | { url: string; depth: number; score?: number })[]; // a start can begin deeper to limit how far it is followed
  keywords: RegExp; // links are followed when URL or link text match
  priority?: (url: string, linkText: string) => number; // higher is fetched sooner; links scoring 0 are still followed if keywords match
  deadlineMs?: number; // total wall-clock budget (default 8000)
  maxDocs?: number; // default 20
  maxPdfs?: number; // default 4
  maxDepth?: number; // default 2
  maxCharsPerDoc?: number; // default 8000
  maxPdfBytes?: number; // default 4 MB
  onDoc?: (count: number) => void; // called after each document is read
};

const UA = "Mozilla/5.0 (compatible; GarageBriefBot/1.0; +https://github.com/vineeth-krishnamurthy/department-brief-builder)";
const SKIP_EXT = /\.(jpe?g|png|gif|svg|webp|ico|css|js|zip|docx?|xlsx?|pptx?|mp4|mp3)(\?|$)/i;

export const bareHost = (h: string) => h.toLowerCase().replace(/^www\./, "");

export async function crawl(opts: CrawlOptions): Promise<Doc[]> {
  const deadline = Date.now() + (opts.deadlineMs ?? 8000);
  const maxDocs = opts.maxDocs ?? 20, maxPdfs = opts.maxPdfs ?? 4, maxDepth = opts.maxDepth ?? 2;
  const maxChars = opts.maxCharsPerDoc ?? 8000, maxPdfBytes = opts.maxPdfBytes ?? 4 * 1024 * 1024;
  const rank = opts.priority ?? (() => 0);

  type Item = { url: string; depth: number; score: number; start?: boolean };
  const starts: Item[] = opts.starts.map((s) => (typeof s === "string" ? { url: s, depth: 0, score: 100, start: true } : { ...s, score: s.score ?? 100, start: true }));
  const sites = new Set(starts.map((s) => safeHost(s.url)).filter(Boolean));
  const seen = new Set<string>();
  const docs: Doc[] = [];
  let pdfs = 0;
  let frontier: Item[] = starts;

  // Best-first: each round fetches the highest-scoring unseen URLs, so a "Request for Bids" link
  // is read before a "Cemetery Commission" link even if it appears later on the page.
  while (frontier.length && docs.length < maxDocs && Date.now() < deadline) {
    frontier = frontier.filter((f) => !seen.has(norm(f.url))).sort((a, b) => b.score - a.score || a.depth - b.depth);
    const batch: Item[] = [];
    while (frontier.length && batch.length < 10) {
      const next = frontier.shift()!;
      if (seen.has(norm(next.url))) continue;
      seen.add(norm(next.url));
      batch.push(next);
    }
    if (!batch.length) break;

    const results = await Promise.all(batch.map((f) => fetchDoc(f.url, f.depth, { deadline, maxChars, maxPdfBytes, allowPdf: pdfs < maxPdfs })));
    for (const [i, r] of results.entries()) {
      if (!r || docs.length >= maxDocs) continue;
      if (batch[i].start) r.doc.start = true;
      // Different links can redirect to the same page; keep it once.
      if (docs.some((d) => norm(d.url) === norm(r.doc.url))) continue;
      seen.add(norm(r.doc.url));
      if (r.doc.kind === "pdf") pdfs++;
      docs.push(r.doc);
      opts.onDoc?.(docs.length);
      if (r.doc.depth >= maxDepth) continue;
      for (const { href, text } of r.links) {
        if (seen.has(norm(href)) || !sites.has(safeHost(href)) || SKIP_EXT.test(href)) continue;
        const score = rank(href, text);
        if (score > 0 || opts.keywords.test(href) || opts.keywords.test(text)) frontier.push({ url: href, depth: r.doc.depth + 1, score });
      }
    }
  }
  return docs;
}

/**
 * Every page URL a site lists in its sitemaps: /sitemap.xml, /sitemap_index.xml, /wp-sitemap.xml,
 * and any Sitemap: lines in robots.txt, following sitemap indexes a level down. Pages that no link
 * reaches any more (an old notice pushed off the first page of a list) are usually still here.
 */
export async function sitemapUrls(origin: string, deadline: number, limit = 3000): Promise<string[]> {
  const host = safeHost(origin);
  const get = async (url: string) => {
    const budget = Math.min(4000, deadline - Date.now());
    if (budget < 300) return "";
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(budget), redirect: "follow" });
      return res.ok ? await res.text() : "";
    } catch {
      return "";
    }
  };
  const robots = await get(`${origin}/robots.txt`);
  const listed = [...robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  const candidates = [...new Set([...listed, `${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/wp-sitemap.xml`])];

  const pages = new Set<string>();
  const readSitemap = async (url: string, depth: number): Promise<void> => {
    const xml = await get(url);
    if (!xml.includes("<loc>")) return;
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
    if (/<sitemapindex/i.test(xml)) {
      if (depth > 0) return;
      // Prefer child sitemaps for pages and posts over images, products, and tags.
      const children = locs.sort((a, b) => Number(/page|post|notice|news/i.test(b)) - Number(/page|post|notice|news/i.test(a))).slice(0, 6);
      await Promise.all(children.map((c) => readSitemap(c, depth + 1)));
      return;
    }
    for (const l of locs) if (safeHost(l) === host && pages.size < limit) pages.add(l);
  };
  for (const c of candidates) {
    await readSitemap(c, 0);
    if (pages.size) break; // the first sitemap that works is enough
  }
  return [...pages];
}

type Fetched = { doc: Doc; links: { href: string; text: string }[] } | null;

async function fetchDoc(url: string, depth: number, o: { deadline: number; maxChars: number; maxPdfBytes: number; allowPdf: boolean }): Promise<Fetched> {
  const budget = Math.min(6000, o.deadline - Date.now());
  if (budget < 500) return null;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(budget), redirect: "follow" });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    const finalUrl = res.url || url;

    if (type.includes("pdf") || /\.pdf(\?|$)/i.test(finalUrl)) {
      if (!o.allowPdf) return null;
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > o.maxPdfBytes) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > o.maxPdfBytes) return null;
      const text = await pdfText(buf, o.deadline);
      if (!text) return null;
      return { doc: { url: finalUrl, title: titleFromUrl(finalUrl), text: text.slice(0, o.maxChars), kind: "pdf", depth }, links: [] };
    }

    if (!type.includes("html")) return null;
    const html = await res.text();
    const title = strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") || titleFromUrl(finalUrl);
    const links: { href: string; text: string }[] = [];
    for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      try { links.push({ href: new URL(m[1], finalUrl).href, text: strip(m[2]).slice(0, 120) }); } catch {}
    }
    return { doc: { url: finalUrl, title, text: strip(html).slice(0, o.maxChars), kind: "html", depth }, links };
  } catch {
    return null;
  }
}

/** Text of the first pages of a PDF via pdf.js (legacy build runs on Node without a worker). */
export async function pdfText(data: Uint8Array, deadline: number, maxPages = 40): Promise<string> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise;
    let text = "";
    for (let i = 1; i <= Math.min(doc.numPages, maxPages) && Date.now() < deadline; i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      text += content.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
    }
    return text.replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

export function strip(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

const norm = (u: string) => u.replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
const safeHost = (u: string) => { try { return bareHost(new URL(u).hostname); } catch { return ""; } };
const titleFromUrl = (u: string) => decodeURIComponent(u.split("/").filter(Boolean).pop() ?? u).replace(/[-_]+/g, " ");
