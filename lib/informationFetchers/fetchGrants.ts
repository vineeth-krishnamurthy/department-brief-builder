import type { Fact, Place } from "../utils/dataTypes";

/**
 * Federal fire grants via USAspending.gov (free, no key).
 * 97.044 Assistance to Firefighters Grant, 97.083 SAFER, 97.045 Fire Prevention & Safety.
 */
const PROGRAMS = ["97.044", "97.083", "97.045"];

type Award = {
  "Award ID": string;
  "Recipient Name": string;
  "Award Amount": number;
  "Start Date": string;
  "End Date": string;
  Description: string;
  "CFDA Number": string;
  generated_internal_id: string;
};

const GENERIC = new Set(["fire", "department", "dept", "district", "company", "inc", "volunteer", "city", "town", "village", "county", "borough", "township", "protection", "rescue", "ems", "emergency", "services", "the", "and"]);
const words = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !GENERIC.has(w));

/** Returns null when the lookup could not run, [] when it ran and found nothing. */
export async function grantFacts(place: Place): Promise<Fact[] | null> {
  if (!place.city || !place.state) return null;
  const body = {
    filters: {
      award_type_codes: ["02", "03", "04", "05"],
      program_numbers: PROGRAMS,
      recipient_locations: [{ country: "USA", state: place.state, city: place.city }],
      time_period: [{ start_date: "2017-01-01", end_date: "2030-12-31" }],
    },
    fields: ["Award ID", "Recipient Name", "Award Amount", "Start Date", "End Date", "Description", "CFDA Number", "generated_internal_id"],
    limit: 25,
    page: 1,
    order: "desc",
    sort: "Start Date",
  };
  const res = await fetch("https://api.usaspending.gov/api/v2/search/spending_by_award/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const { results = [] } = (await res.json()) as { results: Award[] };

  // Keep awards whose recipient looks like this department or its city government.
  const want = new Set([...words(place.name), ...words(place.city)]);
  const matched = results.filter((a) => words(a["Recipient Name"]).some((w) => want.has(w)));

  return matched.slice(0, 6).map((a) => {
    const amt = a["Award Amount"] > 0 ? `$${Math.round(a["Award Amount"]).toLocaleString()}` : "amount not reported";
    const prog = a["CFDA Number"] === "97.083" ? "SAFER" : a["CFDA Number"] === "97.045" ? "Fire Prevention & Safety" : "AFG";
    return {
      text: `${prog} grant ${a["Award ID"]} to ${titleCase(a["Recipient Name"])}: ${amt}, ${a["Start Date"]} to ${a["End Date"]}.`,
      source_url: `https://www.usaspending.gov/award/${a.generated_internal_id}`,
      source_title: "USAspending.gov",
    };
  });
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
