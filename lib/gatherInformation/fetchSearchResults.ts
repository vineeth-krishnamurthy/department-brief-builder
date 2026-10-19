import Anthropic from "@anthropic-ai/sdk";
import type { Place } from "../utils/dataTypes";

/**
 * The first page of web search results for the department, used as extra seed URLs for the
 * crawler. This finds the town's own site, county pages, bid notices, and directory listings
 * that Google Places and the registry don't link to.
 *
 * Providers, in order:
 *  - Serper (Google results API) when SERPER_API_KEY is set: true Google first-page results.
 *  - Claude's web search tool otherwise, which needs only the Anthropic key. Only the result
 *    URLs are used; Claude writes nothing here.
 * Google's own Custom Search API isn't used: it isn't enabled for this project's key, and
 * fetching google.com directly returns a JavaScript-only page.
 *
 * Returns null when no provider could run, [] when the search ran and found nothing.
 */
export type SearchResult = { url: string; title: string };
export type SearchProvider = "serper" | "claude";

// Sites that only repeat the Google listing or can't be read without a login.
const SKIP = /(^|\.)(facebook|instagram|twitter|x|tiktok|linkedin|youtube|pinterest|yelp|mapquest|yellowpages|bbb|nextdoor|tripadvisor|google|bing|apple|waze)\.(com|org)$/i;

export function searchQuery(place: Place) {
  return [place.name, place.city, place.state].filter(Boolean).join(" ");
}

export async function searchResults(place: Place): Promise<{ provider: SearchProvider; results: SearchResult[] } | null> {
  const q = searchQuery(place);
  const found = process.env.SERPER_API_KEY ? await viaSerper(q) : await viaClaude(q);
  if (!found) return null;
  const seen = new Set<string>();
  const results = found.results.filter((r) => {
    try {
      const u = new URL(r.url);
      if (SKIP.test(u.hostname) || seen.has(u.href)) return false;
      seen.add(u.href);
      return true;
    } catch {
      return false;
    }
  });
  return { provider: found.provider, results: results.slice(0, 10) };
}

async function viaSerper(q: string): Promise<{ provider: SearchProvider; results: SearchResult[] } | null> {
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": process.env.SERPER_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({ q, gl: "us", hl: "en", num: 10 }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { organic?: { link: string; title: string }[] };
    return { provider: "serper", results: (data.organic ?? []).map((o) => ({ url: o.link, title: o.title })) };
  } catch {
    return null;
  }
}

let client: Anthropic | null = null;

async function viaClaude(q: string): Promise<{ provider: SearchProvider; results: SearchResult[] } | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    client ??= new Anthropic({ timeout: 20_000, maxRetries: 1 });
    const res = await client.messages.create({
      model: process.env.BRIEF_MODEL ?? "claude-sonnet-5-5",
      max_tokens: 400,
      output_config: { effort: "low" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 1 }],
      messages: [{ role: "user", content: `Run exactly one web search for: ${q}\nThen reply with the single word: done` }],
    });
    const results: SearchResult[] = [];
    for (const block of res.content as unknown as Record<string, unknown>[]) {
      if (block.type !== "web_search_tool_result" || !Array.isArray(block.content)) continue;
      for (const r of block.content as Record<string, unknown>[]) {
        if (typeof r.url === "string") results.push({ url: r.url, title: typeof r.title === "string" ? r.title : "" });
      }
    }
    return { provider: "claude", results };
  } catch {
    return null;
  }
}
