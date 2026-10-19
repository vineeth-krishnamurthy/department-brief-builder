import type { Fact, Section } from "./utils/dataTypes";
import type { Doc } from "./utils/crawler";
import { bareHost } from "./utils/crawler";

/**
 * Every piece of gathered material becomes a numbered source. Claude cites a source by ID
 * and copies a quote; the server fills in the link, type, and date from what the fetcher
 * recorded, and keeps a quote only if it really appears in the text we fetched.
 *
 * Source IDs: R = structured record (registry, grants, 990, apparatus line, surplus listing),
 * D = crawled document.
 */
export type Source = {
  id: string;
  kind: "record" | "document";
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

export function buildSources(input: { knownFacts: Fact[]; docs: Doc[]; deptWebsite: string }): Source[] {
  const deptHost = safeHost(input.deptWebsite);
  const pageType = (url: string) => (safeHost(url) === deptHost ? "Department website" : "City/county website");
  const sources: Source[] = [];

  input.knownFacts.forEach((f, i) =>
    sources.push({
      id: `R${i + 1}`, kind: "record", url: f.source_url, title: f.source_title, text: f.text,
      type: f.source_type ?? pageType(f.source_url), date: f.date, date_label: f.date_label, quote: f.quote,
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
  if (records.length) lines.push("Structured records:", ...records.map((s) => `[${s.id}] (${stamp(s)}) ${s.text}`), "");
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
 * Turn Claude's raw facts into displayable facts. A fact survives only if its evidence states it
 * directly:
 *  - documents (D) and Claude's own search: a quote copied from the fetched text is required, and
 *    every number in the fact must appear in that quote;
 *  - records (R): every number in the fact must appear in the record.
 * Anything else (unknown source, missing or invented quote, a number the evidence doesn't contain)
 * is dropped, with the reason counted.
 */
export type DropCounts = { unknownSource: number; noQuote: number; quoteNotInSource: number; numberNotInEvidence: number };

export type DroppedFact = { text: string; source_id: string; quote?: string; reason: keyof DropCounts };

export function resolveFacts(sections: RawSection[], sources: Source[], web: WebEvidence): { sections: Section[]; dropped: DropCounts; droppedFacts: DroppedFact[] } {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const dropped: DropCounts = { unknownSource: 0, noQuote: 0, quoteNotInSource: 0, numberNotInEvidence: 0 };
  const droppedFacts: DroppedFact[] = [];
  let current: RawFact | null = null;

  const resolved = sections.map((sec) => ({
    title: sec.title,
    facts: sec.facts.flatMap((f): Fact[] => {
      current = f;
      const quote = f.quote?.trim() ?? "";
      const src = byId.get(f.source_id.trim().toUpperCase());

      if (src) {
        const fact: Fact = { text: f.text, source_url: src.url, source_title: src.title, source_type: src.type, date: src.date, date_label: src.date_label };
        if (src.kind === "document") {
          if (!quote) return drop("noQuote");
          if (!verified(quote, src.text)) return drop("quoteNotInSource");
          const q = widenToNumbers(f.text, quote, src.text, `${src.title} ${src.type}`);
          if (!q) return drop("numberNotInEvidence");
          fact.quote = q;
          if (src.html) fact.link = withTextFragment(src.url, q);
          return [fact];
        }
        // The source's own name counts too, so "Form 990" or "FY2024" isn't read as an unsupported number.
        if (!numbersIn(f.text, `${src.text} ${src.title} ${src.type} ${src.date ?? ""}`)) return drop("numberNotInEvidence");
        if (src.quote) {
          fact.quote = src.quote;
          fact.link = withTextFragment(src.url, src.quote);
        }
        return [fact];
      }

      // Claude's single fallback search: the URL must be one its search returned, and the quote
      // must come from a page it fetched (a search snippet alone isn't enough).
      if (f.source_id.toLowerCase() === "web" && f.source_url && web.urls.has(f.source_url)) {
        const page = web.texts.get(f.source_url);
        if (!quote) return drop("noQuote");
        if (!page || !verified(quote, page)) return drop("quoteNotInSource");
        const q = widenToNumbers(f.text, quote, page, "");
        if (!q) return drop("numberNotInEvidence");
        return [{
          text: f.text, source_url: f.source_url, source_title: web.urls.get(f.source_url) || safeHost(f.source_url),
          source_type: "Web search", quote: q, link: withTextFragment(f.source_url, q),
        }];
      }

      return drop("unknownSource");
    }),
  }));
  return { sections: resolved.filter((s) => s.facts.length > 0), dropped, droppedFacts };

  function drop(reason: keyof DropCounts): Fact[] {
    dropped[reason]++;
    if (current) droppedFacts.push({ text: current.text, source_id: current.source_id, quote: current.quote, reason });
    return [];
  }
}

/**
 * The quote, or if it misses a number the fact states, the smallest verbatim span of the same
 * text around it (up to about 40 words) that contains every number. Tables often put a unit's name
 * ("Engine 2") right beside the quoted specs. Returns null when no nearby span supports the fact.
 */
export function widenToNumbers(fact: string, quote: string, text: string, alsoCounts: string): string | null {
  if (numbersIn(fact, `${quote} ${alsoCounts}`)) return quote;
  const words = quote.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const m = new RegExp(words.join("\\W+"), "i").exec(text);
  if (!m) return null;
  for (const pad of [40, 80, 140]) {
    let a = Math.max(0, m.index - pad), b = Math.min(text.length, m.index + m[0].length + pad);
    while (a > 0 && /\S/.test(text[a - 1])) a--; // don't cut words in half
    while (b < text.length && /\S/.test(text[b])) b++;
    const span = text.slice(a, b).replace(/\s+/g, " ").trim();
    if (numbersIn(fact, `${span} ${alsoCounts}`)) return span;
  }
  return null;
}

/** Numbers as written ("$67,727", "2025-09-27", "18%") broken into comparable digit runs. */
function numbers(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.replace(/(\d),(?=\d{3}\b)/g, "$1").matchAll(/\d+(?:\.\d+)?/g)) out.add(String(Number(m[0])));
  return out;
}

/** True when every number in the fact also appears in the evidence. */
export function numbersIn(fact: string, evidence: string): boolean {
  const have = numbers(evidence);
  return [...numbers(fact)].every((n) => have.has(n));
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
