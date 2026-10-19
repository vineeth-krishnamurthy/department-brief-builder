import type { Doc } from "../utils/crawler";

/**
 * The department's social pages, discovered from links on its own website.
 *
 * Facebook serves no post content without a login (verified: the page HTML carries no
 * posts or description), and scraping logged-in content is against its terms. So the
 * page is offered as a link for the AE to open, not read by the crawler. Reading posts
 * would need the Graph API with a token for a page you manage, or a licensed data provider.
 */
export type SocialLink = { network: "facebook" | "instagram" | "x" | "youtube"; url: string };

const NETWORKS: [SocialLink["network"], RegExp][] = [
  ["facebook", /https?:\/\/(?:www\.|m\.)?facebook\.com\/(?!sharer|share|login|plugins|profile\.php)[A-Za-z0-9_.-]{3,}\/?/g],
  ["instagram", /https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9_.]{3,}\/?/g],
  ["x", /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[A-Za-z0-9_]{3,}\/?/g],
  ["youtube", /https?:\/\/(?:www\.)?youtube\.com\/(?:@|c\/|channel\/|user\/)[A-Za-z0-9_.-]{3,}\/?/g],
];

export function socialLinks(docs: Doc[]): SocialLink[] {
  const haystack = docs.flatMap((d) => d.social ?? []).join("\n");
  const out: SocialLink[] = [];
  for (const [network, re] of NETWORKS) {
    const counts = new Map<string, number>();
    for (const m of haystack.matchAll(re)) {
      const url = m[0].replace(/\/$/, "");
      counts.set(url, (counts.get(url) ?? 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) out.push({ network, url: best[0] });
  }
  return out;
}
