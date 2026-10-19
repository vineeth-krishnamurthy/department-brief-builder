import type { Place } from "../utils/dataTypes";

/**
 * Recent news headlines via Google News RSS (free, no key).
 * Three queries run in parallel: leadership, funding, and the fire-service trade press
 * (Fire Apparatus Magazine, Firehouse, FireRescue1, Firefighter Nation), whose stories
 * announce apparatus deliveries, station projects, and fleet plans by department name.
 * Headlines are passed to Claude as leads; the link opens the article through Google News.
 * Returns null when the lookup could not run, [] when nothing relevant was found.
 */
export type Headline = { title: string; url: string; publisher: string; date: string; topic: "leadership" | "funding" | "apparatus" };

export const TRADE_PRESS = ["fireapparatusmagazine.com", "firehouse.com", "firerescue1.com", "firefighternation.com"];

const LEADERSHIP = /chief|commissioner|director|president|appoint|named|promot|retir|swor|elect|hire/i;
const FUNDING = /grant|budget|fund|levy|tax|bond|referendum|purchase|approv|million|\$|donat|fundrais|award/i;

export async function newsHeadlines(place: Place): Promise<Headline[] | null> {
  const name = `"${place.name}"`;
  const queries: [Headline["topic"], string][] = [
    ["leadership", `${name} chief`],
    ["funding", `${name} (grant OR budget OR funding OR purchase)`],
    ["apparatus", `(${TRADE_PRESS.map((d) => `site:${d}`).join(" OR ")}) ${name}`],
  ];
  const results = await Promise.all(queries.map(([topic, q]) => search(q, topic)));
  if (results.every((r) => r === null)) return null;

  // Keep headlines that actually mention the department (or its city) and match the topic.
  const city = place.city.toLowerCase();
  const nameWord = distinctive(place.name);
  const seen = new Set<string>();
  return results
    .flatMap((r) => r ?? [])
    .filter((h) => {
      const t = h.title.toLowerCase();
      const aboutUs = (nameWord && t.includes(nameWord)) || (city && t.includes(city));
      // Trade-press stories are about the department by construction; the other two must match their topic.
      const onTopic = h.topic === "apparatus" ? true : (h.topic === "leadership" ? LEADERSHIP : FUNDING).test(h.title) && /fire/i.test(h.title);
      if (!aboutUs || !onTopic || seen.has(h.title)) return false;
      seen.add(h.title);
      return true;
    })
    .slice(0, 12);
}

async function search(q: string, topic: Headline["topic"]): Promise<Headline[] | null> {
  try {
    // Trade press runs rarely about any one department, so look back further there.
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + (topic === "apparatus" ? " when:5y" : " when:2y"))}&hl=en-US&gl=US&ceid=US:en`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { "User-Agent": "Mozilla/5.0 (compatible; GarageBriefBot/1.0)" } });
    if (!res.ok) return null;
    const xml = await res.text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 15).map(([, item]) => {
      const raw = decode(tag(item, "title"));
      const publisher = decode(tag(item, "source"));
      // Google appends " - Publisher" to titles; drop it since we show the publisher separately.
      const title = publisher && raw.endsWith(` - ${publisher}`) ? raw.slice(0, -publisher.length - 3) : raw;
      return { title, url: tag(item, "link"), publisher, date: new Date(tag(item, "pubDate")).toISOString().slice(0, 10), topic };
    });
  } catch {
    return null;
  }
}

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1]?.trim() ?? "";
const decode = (s: string) =>
  s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** The most identifying word in a department name, e.g. "wise" in "Wise Avenue Volunteer Fire Co". */
function distinctive(name: string): string {
  const generic = /^(fire|department|dept|company|co|inc|volunteer|vol|the|of|and|district|station|rescue|ems|avenue|ave|street|st|road|rd|county|city|town|township|village)$/i;
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).find((w) => w.length > 2 && !generic.test(w)) ?? "";
}
