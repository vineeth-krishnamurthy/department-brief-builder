import { kv } from "./kv";
import type { Brief } from "./dataTypes";

/**
 * Three things are remembered, each under its own key:
 *  - brief:<placeId>   the finished brief, with a TTL (repeat lookups are instant until refreshed)
 *  - src:<placeId>     URLs that produced cited facts last run (fetched first next run)
 *  - domains           sorted set of how often each domain produced a cited fact
 */
export type Memory = { urls: { url: string; section: string; last_seen: string }[] };

const BRIEF_TTL = Number(process.env.BRIEF_TTL_SECONDS ?? 24 * 60 * 60);
const SOURCE_TTL = 90 * 24 * 60 * 60;

export const getBrief = (placeId: string) => kv.get<Brief>(`brief:${placeId}`);
export const putBrief = (brief: Brief) => kv.set(`brief:${brief.place.id}`, brief, BRIEF_TTL);

export async function recall(placeId: string): Promise<{ memory: Memory | null; topDomains: string[] }> {
  const [memory, topDomains] = await Promise.all([kv.get<Memory>(`src:${placeId}`), kv.ztop("domains", 15)]);
  return { memory, topDomains };
}

export async function remember(placeId: string, urls: { url: string; section: string }[]) {
  const now = new Date().toISOString();
  const hosts = new Set<string>();
  for (const { url } of urls) {
    try {
      hosts.add(new URL(url).hostname.replace(/^www\./, ""));
    } catch {}
  }
  await Promise.all([
    kv.set(`src:${placeId}`, { urls: urls.map((u) => ({ ...u, last_seen: now })) }, SOURCE_TTL),
    ...[...hosts].map((h) => kv.zincr("domains", h)),
  ]);
}
