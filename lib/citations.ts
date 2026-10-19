import type { Fact, Section } from "./utils/dataTypes";
import type { Doc } from "./utils/crawler";
import type { Headline } from "./informationFetchers/fetchNews";
import { bareHost } from "./utils/crawler";

/**
 * Every piece of gathered material becomes a numbered source. Claude cites a source by ID
 * and copies a quote; the server fills in the link, type, and date from what the fetcher
 * recorded, and keeps a quote only if it really appears in the text we fetched.
 *
 * Source IDs: R = structured record (registry, grants, 990, apparatus line, surplus listing),
 * H = headline, D = crawled document.
 */
export type Source = {
  id: string;
  kind: "record" | "headline" | "document";
  url: string;
  title: string;
  type: string; // shown on the chip, e.g. "Federal grant record"
  text: string; // what quotes are verified against
  date?: string; // only when the source itself states it
  date_label?: string;
  quote?: string; // records whose evidence line is known in advance (apparatus)
  html?: boolean; // documents that can take a text-fragment link
};

export type RawFact = { text: string; source_id: string; quote?: string; source_url?: string };
export type RawSection = { title: string; facts: RawFact[] };
export type WebEvidence = { urls: Map<string, string>; texts: Map<string, string> }; // url -> title, url -> fetched text

export function buildSources(input: { knownFacts: Fact[]; news: Headline[] | null; docs: Doc[]; deptWebsite: string }): Source[] {
  const deptHost = safeHost(input.deptWebsite);
  const pageType = (url: string) => (safeHost(url) === deptHost ? "Department website" : "City/county website");
  const sources: Source[] = [];

  input.knownFacts.forEach((f, i) =>
    sources.push({
      id: `R${i + 1}`, kind: "record", url: f.source_url, title: f.source_title, text: f.text,
      type: f.source_type ?? pageType(f.source_url), date: f.date, date_label: f.date_label, quote: f.quote,
    }),
  );
  (input.news ?? []).forEach((h, i) =>
    sources.push({
      id: `H${i + 1}`, kind: "headline", url: h.url, title: h.publisher || "News", text: h.title,
      type: h.topic === "apparatus" ? "Trade press" : "News", date: h.date, date_label: "Published",
    }),
  );
  input.docs.forEach((d, i) =>
    sources.push({
      id: `D${i + 1}`, kind: "document", url: d.url, title: d.title, text: d.text,
      type: d.source_type ?? pageType(d.url), date: d.date, date_label: d.date_label, html: d.kind === "html",
    }),
  );
  return sources;
}

/** How sources appear in the prompt. Documents share a character budget; the rest are one line each. */
export function renderSources(sources: Source[], docBudget: number): string[] {
  const stamp = (s: Source) => [s.type, s.date && `${s.date_label} ${s.date}`].filter(Boolean).join(", ");
  const lines: string[] = [];
  const records = sources.filter((s) => s.kind === "record");
  const headlines = sources.filter((s) => s.kind === "headline");
  if (records.length) lines.push("Structured records:", ...records.map((s) => `[${s.id}] (${stamp(s)}) ${s.text}`), "");
  if (headlines.length) lines.push("Headlines:", ...headlines.map((s) => `[${s.id}] (${stamp(s)}, ${s.title}) "${s.text}"`), "");
  let left = docBudget;
  for (const s of sources.filter((x) => x.kind === "document")) {
    if (left < 400) break;
    const text = s.text.slice(0, left);
    left -= text.length;
    lines.push(`--- [${s.id}] ${stamp(s)}: ${s.title}`, text, "");
  }
  return lines;
}

/**
 * Turn Claude's raw facts into displayable facts. Facts citing an unknown source are dropped.
 * Quotes are kept only when they appear in the source text (ignoring case and punctuation).
 */
export function resolveFacts(sections: RawSection[], sources: Source[], web: WebEvidence): { sections: Section[]; dropped: number; unverifiedQuotes: number } {
  const byId = new Map(sources.map((s) => [s.id, s]));
  let dropped = 0, unverifiedQuotes = 0;

  const resolved = sections.map((sec) => ({
    title: sec.title,
    facts: sec.facts.flatMap((f): Fact[] => {
      const src = byId.get(f.source_id.trim().toUpperCase());

      if (src) {
        const fact: Fact = { text: f.text, source_url: src.url, source_title: src.title, source_type: src.type, date: src.date, date_label: src.date_label };
        if (src.kind === "record") {
          if (src.quote) {
            fact.quote = src.quote;
            fact.link = withTextFragment(src.url, src.quote);
          }
        } else if (src.kind === "headline") {
          fact.quote = src.text;
        } else if (f.quote && verified(f.quote, src.text)) {
          fact.quote = f.quote.trim();
          if (src.html) fact.link = withTextFragment(src.url, fact.quote);
        } else if (f.quote) {
          unverifiedQuotes++;
        }
        return [fact];
      }

      // Facts from Claude's single fallback search: the URL must have appeared in its own search results.
      if (f.source_id.toLowerCase() === "web" && f.source_url && web.urls.has(f.source_url)) {
        const fact: Fact = { text: f.text, source_url: f.source_url, source_title: web.urls.get(f.source_url) || safeHost(f.source_url), source_type: "Web search" };
        const page = web.texts.get(f.source_url);
        if (f.quote && page && verified(f.quote, page)) {
          fact.quote = f.quote.trim();
          fact.link = withTextFragment(f.source_url, fact.quote);
        } else if (f.quote) {
          unverifiedQuotes++;
        }
        return [fact];
      }

      dropped++;
      return [];
    }),
  }));
  return { sections: resolved.filter((s) => s.facts.length > 0), dropped, unverifiedQuotes };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function verified(quote: string, text: string): boolean {
  const q = norm(quote);
  return q.split(" ").length >= 3 && norm(text).includes(q);
}

/** A link that opens the page with the quote highlighted (browser text fragments). */
export function withTextFragment(url: string, quote: string): string {
  const words = quote.trim().split(/\s+/);
  const enc = (s: string) => encodeURIComponent(s).replace(/-/g, "%2D");
  const fragment = words.length > 12 ? `${enc(words.slice(0, 5).join(" "))},${enc(words.slice(-5).join(" "))}` : enc(words.join(" "));
  return `${url.split("#")[0]}#:~:text=${fragment}`;
}

function safeHost(url: string) {
  try {
    return bareHost(new URL(url).hostname);
  } catch {
    return "";
  }
}
