import { pdfText, strip, type Doc } from "../utils/crawler";
import type { Place } from "../utils/dataTypes";

/**
 * Council and board records where apparatus purchases, budgets, and chief appointments are
 * decided. Two platforms are queried directly; the rest are reached by the site crawler
 * when a city page links to them (Granicus, iQM2, BoardDocs, PrimeGov, and so on).
 *
 *  - Legistar (Granicus): free public API at webapi.legistar.com/v1/{client}/. There is no
 *    directory of clients, so likely slugs for the city are tried and verified first.
 *  - CivicPlus AgendaCenter: /AgendaCenter on the city's own domain lists agendas and
 *    minutes as PDFs. Recent ones that mention the fire department are read.
 *
 * Returns null when nothing could be checked, [] when platforms were found but nothing matched.
 */
const FIRE = /\bfire\b/i;
const MONEY_OR_FLEET = /apparatus|engine|pumper|ladder|aerial|tanker|ambulance|vehicle|budget|grant|purchase|bid|award|contract|capital|lease|chief/i;

export async function meetingDocs(place: Place, hosts: string[]): Promise<Doc[] | null> {
  const deadline = Date.now() + 8000;
  const [legistar, civic] = await Promise.all([fromLegistar(place, deadline), fromCivicPlus(hosts, deadline)]);
  if (legistar === null && civic === null) return null;
  return [...(legistar ?? []), ...(civic ?? [])];
}

// ---- Legistar ----

async function fromLegistar(place: Place, deadline: number): Promise<Doc[] | null> {
  const city = place.city.toLowerCase().replace(/[^a-z]/g, "");
  if (!city) return null;
  const slugs = [city, `cityof${city}`, `${city}city`, `${city}${place.state.toLowerCase()}`, `${city}county`];

  const client = (await Promise.all(slugs.map(async (s) => ((await legistarOk(s)) ? s : null)))).find(Boolean);
  if (!client) return null;

  try {
    const since = new Date(Date.now() - 2 * 365 * 86400e3).toISOString().slice(0, 10);
    const filter = `substringof('Fire', MatterTitle) and MatterIntroDate ge datetime'${since}'`;
    const url = `https://webapi.legistar.com/v1/${client}/matters?$filter=${encodeURIComponent(filter)}&$orderby=MatterIntroDate desc&$top=40`;
    const res = await fetch(url, { signal: AbortSignal.timeout(Math.max(500, deadline - Date.now())) });
    if (!res.ok) return [];
    const matters = (await res.json()) as { MatterId: number; MatterFile: string; MatterTitle: string; MatterIntroDate: string; MatterStatusName: string; MatterBodyName: string }[];
    return matters
      .filter((m) => MONEY_OR_FLEET.test(m.MatterTitle))
      .slice(0, 12)
      .map((m) => ({
        url: `https://webapi.legistar.com/v1/${client}/matters/${m.MatterId}`,
        title: `Legistar ${m.MatterFile}`,
        text: `${m.MatterIntroDate.slice(0, 10)} ${m.MatterBodyName} (${m.MatterStatusName}): ${m.MatterTitle}`,
        kind: "html" as const,
        depth: 0,
        source_type: "Meeting record",
        date: m.MatterIntroDate.slice(0, 10),
        date_label: "Introduced",
      }));
  } catch {
    return null;
  }
}

async function legistarOk(slug: string) {
  try {
    const res = await fetch(`https://webapi.legistar.com/v1/${slug}/bodies?$top=1`, { signal: AbortSignal.timeout(4000) });
    return res.ok && (await res.text()).startsWith("[");
  } catch {
    return false;
  }
}

// ---- CivicPlus AgendaCenter ----

async function fromCivicPlus(hosts: string[], deadline: number): Promise<Doc[] | null> {
  const found = (await Promise.all(hosts.map((h) => agendaCenter(h, deadline)))).filter((d): d is Doc[] => d !== null);
  if (!found.length) return null;
  return found.flat().slice(0, 6);
}

async function agendaCenter(host: string, deadline: number): Promise<Doc[] | null> {
  try {
    const index = `https://${host}/AgendaCenter`;
    const res = await fetch(index, { signal: AbortSignal.timeout(4000), headers: { "User-Agent": "Mozilla/5.0 (compatible; GarageBriefBot/1.0)" } });
    if (!res.ok) return null;
    const html = await res.text();
    if (!/AgendaCenter\/ViewFile/.test(html)) return null;

    // Newest council and budget documents first; the file name encodes the meeting date.
    const links = [...new Set([...html.matchAll(/\/AgendaCenter\/ViewFile\/(Agenda|Minutes)\/(_\d{8}-\d+)/g)].map((m) => `${m[1]}/${m[2]}`))]
      .sort((a, b) => dateKey(b).localeCompare(dateKey(a)))
      .slice(0, 4);

    const docs = await Promise.all(links.map(async (l): Promise<Doc | null> => {
      const url = `https://${host}/AgendaCenter/ViewFile/${l}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(Math.max(500, deadline - Date.now())) }).catch(() => null);
      if (!r?.ok) return null;
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.byteLength > 6 * 1024 * 1024) return null;
      const text = (r.headers.get("content-type") ?? "").includes("pdf") ? await pdfText(buf, deadline, 60) : strip(new TextDecoder().decode(buf));
      if (!FIRE.test(text)) return null;
      return {
        url, title: `${l.split("/")[0]} ${dateKey(l)} (${host})`, text: fireExcerpts(text), kind: "pdf", depth: 0,
        source_type: "Meeting record", date: dateKey(l) || undefined, date_label: dateKey(l) ? "Meeting" : undefined,
      };
    }));
    return docs.filter((d): d is Doc => !!d && d.text.length > 50);
  } catch {
    return null;
  }
}

/** Only the sentences around "fire", so a 40-page packet doesn't flood the prompt. */
function fireExcerpts(text: string, max = 4000) {
  const out: string[] = [];
  for (const m of text.matchAll(/[^.]{0,200}\bfire\b[^.]{0,250}\./gi)) {
    if (MONEY_OR_FLEET.test(m[0])) out.push(m[0].trim());
    if (out.join(" ").length > max) break;
  }
  return out.join(" ");
}

const dateKey = (l: string) => { const m = l.match(/_(\d{2})(\d{2})(\d{4})/); return m ? `${m[3]}-${m[1]}-${m[2]}` : ""; };
