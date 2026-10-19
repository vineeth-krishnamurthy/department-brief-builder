import type { Fact, Place } from "../utils/dataTypes";

/**
 * Federal fire grants from two structured sources, merged and de-duplicated by award number:
 *  - FEMA's own award list (OpenFEMA "NonDisasterAssistanceFirefighterGrants"): every AFG, SAFER,
 *    and Fire Prevention & Safety award by fiscal year, keyed by recipient name + state.
 *  - USAspending.gov: the same awards with obligation amounts and period of performance.
 * Neither source carries an FDID, so the join to the department is on name and location.
 * Returns null when both lookups failed, [] when both ran and found nothing.
 */
const CFDA = ["97.044", "97.083", "97.045"];
const SINCE_FY = 2015;

const GENERIC = new Set(["fire", "department", "dept", "district", "company", "inc", "volunteer", "city", "town", "village", "county", "borough", "township", "protection", "rescue", "ems", "emergency", "services", "the", "and", "of", "co", "vol", "corp"]);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !GENERIC.has(w));

type Award = { id: string; program: string; recipient: string; amount: number; start: string; end?: string; url: string; source: string; date: string; dateLabel: string };

export async function grantFacts(place: Place): Promise<Fact[] | null> {
  if (!place.state) return null;
  const want = new Set([...words(place.name), ...words(place.city)]);
  if (want.size === 0) return [];
  const matches = (recipient: string) => words(recipient).some((w) => want.has(w));

  const [fema, usa] = await Promise.all([fromFema(place, matches), fromUsaspending(place, matches)]);
  if (fema === null && usa === null) return null;

  // USAspending rows carry dates and the award page; FEMA rows fill in anything USAspending lacks.
  const byId = new Map<string, Award>();
  for (const a of [...(usa ?? []), ...(fema ?? [])]) if (!byId.has(a.id)) byId.set(a.id, a);
  const awards = [...byId.values()].sort((a, b) => b.start.localeCompare(a.start)).slice(0, 8);

  return awards.map((a) => ({
    text: `${a.program} grant ${a.id} to ${titleCase(a.recipient)}: ${a.amount > 0 ? `$${Math.round(a.amount).toLocaleString()}` : "amount not reported"}${a.end ? `, ${a.start} to ${a.end}` : `, FY${a.start.slice(0, 4)}`}.`,
    source_url: a.url,
    source_title: a.source,
    source_type: "Federal grant record",
    date: a.date,
    date_label: a.dateLabel,
  }));
}

async function fromFema(place: Place, matches: (r: string) => boolean): Promise<Award[] | null> {
  try {
    // OpenFEMA supports eq/startswith but not substring filters, so pull the state's recent rows and match locally.
    const filter = `vendorState eq '${place.state}' and fiscalYear ge ${SINCE_FY}`;
    const url = `https://www.fema.gov/api/open/v1/NonDisasterAssistanceFirefighterGrants?$filter=${encodeURIComponent(filter)}&$select=fiscalYear,programName,awardNumber,vendorName,awardAmount&$top=1000&$orderby=fiscalYear desc`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const rows = ((await res.json()).NonDisasterAssistanceFirefighterGrants ?? []) as { fiscalYear: number; programName: string; awardNumber: string; vendorName: string; awardAmount: number }[];
    return rows
      .filter((r) => /firefighter|safer|fire prevention/i.test(r.programName) && matches(r.vendorName))
      .map((r) => ({
        id: r.awardNumber, program: programLabel(r.programName), recipient: r.vendorName, amount: r.awardAmount,
        start: `${r.fiscalYear}-00-00`, url: "https://www.fema.gov/grants/preparedness/firefighters", source: "FEMA award list (OpenFEMA)",
        date: String(r.fiscalYear), dateLabel: "Fiscal year",
      }));
  } catch {
    return null;
  }
}

async function fromUsaspending(place: Place, matches: (r: string) => boolean): Promise<Award[] | null> {
  if (!place.city) return [];
  try {
    const body = {
      filters: {
        award_type_codes: ["02", "03", "04", "05"],
        program_numbers: CFDA,
        recipient_locations: [{ country: "USA", state: place.state, city: place.city }],
        time_period: [{ start_date: `${SINCE_FY}-01-01`, end_date: "2030-12-31" }],
      },
      fields: ["Award ID", "Recipient Name", "Award Amount", "Start Date", "End Date", "CFDA Number", "generated_internal_id"],
      limit: 50, page: 1, order: "desc", sort: "Start Date",
    };
    const res = await fetch("https://api.usaspending.gov/api/v2/search/spending_by_award/", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const rows = ((await res.json()).results ?? []) as Record<string, string | number>[];
    return rows
      .filter((r) => matches(String(r["Recipient Name"])))
      .map((r) => ({
        id: String(r["Award ID"]), program: programLabel(String(r["CFDA Number"])), recipient: String(r["Recipient Name"]),
        amount: Number(r["Award Amount"]), start: String(r["Start Date"]), end: String(r["End Date"]),
        url: `https://www.usaspending.gov/award/${r.generated_internal_id}`, source: "USAspending.gov",
        date: String(r["Start Date"]), dateLabel: "Award start",
      }));
  } catch {
    return null;
  }
}

function programLabel(s: string) {
  if (/97\.083|safer|staffing/i.test(s)) return "SAFER";
  if (/97\.045|prevention/i.test(s)) return "Fire Prevention & Safety";
  return "AFG";
}
const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
