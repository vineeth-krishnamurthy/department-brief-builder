import { strip } from "../utils/crawler";
import type { Fact, Place } from "../utils/dataTypes";

/**
 * Surplus marketplace listings by this department. A department already selling a
 * vehicle elsewhere is the strongest signal an AE can have.
 *  - Municibid: public search page.
 *  - PublicSurplus: public keyword search.
 *  - GovDeals blocks automated requests, so only a search link is offered.
 * Returns null when both searches failed, [] when nothing by this department was found.
 */
const UA = "Mozilla/5.0 (compatible; GarageBriefBot/1.0)";
const GENERIC = /^(fire|department|dept|company|co|inc|volunteer|vol|the|of|and|district|station|rescue|ems|city|town|county|village)$/i;

export function govdealsSearchUrl(place: Place) {
  return `https://www.govdeals.com/en/search?kWord=${encodeURIComponent(`${place.city} fire`)}`;
}

export async function surplusFacts(place: Place): Promise<Fact[] | null> {
  const key = place.name.split(/\s+/).find((w) => w.length > 2 && !GENERIC.test(w)) ?? place.city;
  const [mb, ps] = await Promise.all([municibid(key), publicSurplus(key)]);
  if (mb === null && ps === null) return null;
  const want = new RegExp(`\\b${escape(key)}\\b`, "i");
  return [...(mb ?? []), ...(ps ?? [])].filter((f) => want.test(f.text)).slice(0, 5);
}

async function municibid(key: string): Promise<Fact[] | null> {
  try {
    const res = await fetch(`https://municibid.com/search?q=${encodeURIComponent(`${key} fire`)}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const html = await res.text();
    return [...html.matchAll(/href="(\/listing\/\d+\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
      .map((m) => ({ text: `Municibid listing: ${strip(m[2]) || m[1].split("/").pop()?.replace(/-/g, " ")}`, source_url: `https://municibid.com${m[1]}`, source_title: "Municibid", source_type: "Surplus listing" }))
      .filter((f, i, a) => a.findIndex((x) => x.source_url === f.source_url) === i);
  } catch {
    return null;
  }
}

async function publicSurplus(key: string): Promise<Fact[] | null> {
  try {
    const res = await fetch(`https://www.publicsurplus.com/sms/browse/search?posting=y&keyWord=${encodeURIComponent(`${key} fire`)}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const html = await res.text();
    return [...html.matchAll(/auction\/view\?auc=(\d+)[^>]*>([^<]{5,160})</g)]
      .map((m) => ({ text: `PublicSurplus auction: ${strip(m[2])}`, source_url: `https://www.publicsurplus.com/sms/auction/view?auc=${m[1]}`, source_title: "PublicSurplus", source_type: "Surplus listing" }))
      .filter((f, i, a) => a.findIndex((x) => x.source_url === f.source_url) === i);
  } catch {
    return null;
  }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
