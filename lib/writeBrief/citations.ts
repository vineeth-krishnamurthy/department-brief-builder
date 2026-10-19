import type { Fact, Section } from "../utils/dataTypes";
import type { Doc } from "../gatherInformation/crawler";
import { bareHost } from "../gatherInformation/crawler";

/**
 * Every piece of gathered material becomes a numbered source. Claude cites a source by ID
 * and copies a quote; the server fills in the link, type, and date from what the fetcher
 * recorded, and keeps a quote only if it really appears in the text we fetched.
 *
 * Source IDs: R = structured record (registry, grants, 990, apparatus line),
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

export type RawFact = { text: string; source_id: string; quote?: string; source_url?: string; date?: string };
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
 *  - documents (D) and Claude's own search: a quote is required, and it must appear in some page we
 *    fetched. If it isn't in the page Claude cited, the fact is cited to the page it is in. Every
 *    number in the fact must appear in that quote;
 *  - records (R): every number in the fact must appear in the record.
 * The citation carries a date whenever one is found: the date Claude read for the fact, if that
 * page shows it, otherwise the date the fetcher recorded for the source.
 * Anything else (unknown source, missing quote, a quote in no fetched page, a number the evidence
 * doesn't contain) is dropped, with the reason counted.
 */
export type DropCounts = { unknownSource: number; noQuote: number; quoteNotInSource: number; numberNotInEvidence: number };

export type DroppedFact = { text: string; source_id: string; quote?: string; reason: keyof DropCounts };

export function resolveFacts(sections: RawSection[], sources: Source[], web: WebEvidence): { sections: Section[]; dropped: DropCounts; droppedFacts: DroppedFact[] } {
  const byId = new Map(sources.map((s) => [s.id, s]));
  // Every page we fetched, crawled or from Claude's own search, can back a quote.
  const pages: Source[] = [
    ...sources.filter((s) => s.kind === "document"),
    ...[...web.texts].map(([url, text]): Source => ({
      id: "web", kind: "document", url, text, title: web.urls.get(url) || safeHost(url), type: "Web search", html: true,
    })),
  ];
  const dropped: DropCounts = { unknownSource: 0, noQuote: 0, quoteNotInSource: 0, numberNotInEvidence: 0 };
  const droppedFacts: DroppedFact[] = [];
  let current: RawFact | null = null;

  const resolved = sections.map((sec) => ({
    title: sec.title,
    facts: sec.facts.flatMap((f): Fact[] => {
      current = f;
      const quote = f.quote?.trim() ?? "";
      const isWeb = f.source_id.trim().toLowerCase() === "web";
      const cited = isWeb ? pages.find((p) => p.id === "web" && p.url === f.source_url) : byId.get(f.source_id.trim().toUpperCase());
      if (!cited && !isWeb) return drop("unknownSource");

      if (cited?.kind === "record") {
        // The source's own name counts too, so "Form 990" or "FY2024" isn't read as an unsupported number.
        if (!numbersIn(f.text, `${cited.text} ${cited.title} ${cited.type} ${cited.date ?? ""}`)) return drop("numberNotInEvidence");
        return [{
          ...citation(cited), text: f.text,
          ...(cited.quote && { quote: cited.quote, link: withTextFragment(cited.url, cited.quote) }),
        }];
      }

      if (!quote) return drop("noQuote");
      const page = cited && verified(quote, cited.text) ? cited : pages.find((p) => verified(quote, p.text));
      if (!page) return drop("quoteNotInSource");
      const cite = citation(page, f.date);
      // A date the page shows may also appear in the fact text.
      const q = widenToNumbers(f.text, quote, page.text, `${page.title} ${page.type} ${cite.date ?? ""}`);
      if (!q) return drop("numberNotInEvidence");
      return [{ ...cite, text: f.text, quote: q, ...(page.html && { link: withTextFragment(page.url, q) }) }];
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
 * Link, title, type, and date for a fact cited to this source. Records keep their own date; for a
 * page, the date Claude read for the fact wins if the page shows it.
 */
function citation(src: Source, factDate?: string): Omit<Fact, "text"> {
  const d = factDate?.trim();
  const shown = d && src.kind === "document" && norm(`${src.title} ${src.text}`).includes(norm(d));
  return {
    source_url: src.url, source_title: src.title, source_type: src.type,
    ...(shown ? { date: d } : { date: src.date, date_label: src.date_label }),
  };
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
