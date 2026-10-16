/**
 * The department's own website: homepage plus any linked pages that look like
 * apparatus, leadership, budget, or news. Returned as plain text for Claude to read.
 */
export type Page = { url: string; title: string; text: string };

const INTERESTING = /apparatus|fleet|equipment|vehicle|engine|truck|chief|staff|leadership|personnel|administration|about|budget|news|press|announce|grant/i;
const MAX_PAGES = 5;
const MAX_CHARS = 6000;

export async function fetchDeptPages(website: string): Promise<Page[]> {
  if (!website) return [];
  const home = await fetchPage(website);
  if (!home) return [];

  // Resolve links against where the homepage actually landed after redirects.
  const base = new URL(home.url);
  const site = bareHost(base.hostname);
  const links = new Set<string>();
  for (const m of home.html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const [, href, label] = m;
    if (!INTERESTING.test(href) && !INTERESTING.test(strip(label))) continue;
    try {
      const u = new URL(href, base);
      if (bareHost(u.hostname) === site && !/\.(pdf|jpg|png|gif|zip)$/i.test(u.pathname)) links.add(u.href);
    } catch {}
    if (links.size >= MAX_PAGES) break;
  }

  const subs = await Promise.all([...links].map(fetchPage));
  return [home, ...subs].filter((p): p is NonNullable<typeof p> => !!p).map(({ url, title, html }) => ({
    url,
    title,
    text: strip(html).slice(0, MAX_CHARS),
  }));
}

async function fetchPage(url: string) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GarageBriefBot/1.0)" },
      signal: AbortSignal.timeout(6000),
      redirect: "follow",
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    const html = await res.text();
    const title = strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") || url;
    return { url: res.url || url, title, html };
  } catch {
    return null;
  }
}

function strip(html: string): string {
  return html
    .replace(/<(script|style|nav|footer|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

/** www.example.org and example.org are the same site. */
const bareHost = (h: string) => h.toLowerCase().replace(/^www\./, "");
