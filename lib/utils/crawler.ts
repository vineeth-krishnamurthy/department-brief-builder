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
  social?: string[];
  source_type?: string; // set by fetchers that know better than "website"
  date?: string; // only when the source states it (meeting date, introduction date)
  date_label?: string;
};

const SOCIAL = /^https?:\/\/(?:www\.|m\.)?(facebook|instagram|twitter|x|youtube)\.com\//i;

export type CrawlOptions = {
  starts: (string | { url: string; depth: number })[]; // a start can begin deeper to limit how far it is followed
  keywords: RegExp; // links are followed when URL or link text match
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

  const starts = opts.starts.map((s) => (typeof s === "string" ? { url: s, depth: 0 } : s));
  const sites = new Set(starts.map((s) => safeHost(s.url)).filter(Boolean));
  const seen = new Set<string>();
  const docs: Doc[] = [];
  let pdfs = 0;
  let frontier = starts;

  while (frontier.length && docs.length < maxDocs && Date.now() < deadline) {
    const batch = frontier.filter((f) => !seen.has(norm(f.url))).slice(0, 8);
    batch.forEach((f) => seen.add(norm(f.url)));
    frontier = frontier.slice(batch.length);

    const results = await Promise.all(batch.map((f) => fetchDoc(f.url, f.depth, { deadline, maxChars, maxPdfBytes, allowPdf: pdfs < maxPdfs })));
    for (const r of results) {
      if (!r) continue;
      // Different links can redirect to the same page; keep it once.
      if (docs.some((d) => norm(d.url) === norm(r.doc.url))) continue;
      seen.add(norm(r.doc.url));
      if (r.doc.kind === "pdf") pdfs++;
      docs.push(r.doc);
      opts.onDoc?.(docs.length);
      if (r.doc.depth >= maxDepth) continue;
      for (const { href, text } of r.links) {
        if (seen.has(norm(href)) || !sites.has(safeHost(href)) || SKIP_EXT.test(href)) continue;
        if (opts.keywords.test(href) || opts.keywords.test(text)) frontier.push({ url: href, depth: r.doc.depth + 1 });
      }
    }
  }
  return docs;
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
    const social = [...new Set(links.map((l) => l.href).filter((h) => SOCIAL.test(h)))].slice(0, 10);
    return { doc: { url: finalUrl, title, text: strip(html).slice(0, o.maxChars), kind: "html", depth, social }, links };
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
