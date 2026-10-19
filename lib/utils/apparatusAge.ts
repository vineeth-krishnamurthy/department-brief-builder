import type { Fact } from "./dataTypes";

/**
 * Apparatus age flags per NFPA 1911 guidance: units over 15 years old belong in reserve,
 * units over 25 years old should be replaced. Years come from whatever text we gathered,
 * so each flag keeps the URL of the page it was read from.
 */
export const RESERVE_AGE = 15;
export const REPLACE_AGE = 25;

const UNIT = "(Engine|Pumper|Ladder|Truck|Tower|Aerial|Quint|Tanker|Tender|Rescue|Squad|Brush|Medic|Ambulance|Utility|Command)";
const MAKE = "(Pierce|E-?ONE|Rosenbauer|Sutphen|Seagrave|Spartan|KME|Ferrara|Smeal|Alexis|Toyne|HME|Freightliner|International|Ford|Chevrolet|Chevy|Dodge|Ram|Spencer|Crimson|American LaFrance|Darley|Marion|Horton|Wheeled Coach|Kenworth|Peterbilt|Mack|Braun|Demers|Fouts|4 Guys|Deep South|Midwest Fire|Oshkosh|Grumman|Saulsbury|Emergency One)";
const YEAR = "((?:19|20)\\d{2})";

// "Engine 271 – 2017 Rosenbauer Commander" and "2003 Freightliner ... Engine 2"
const PATTERNS = [
  new RegExp(`\\b${UNIT}\\s*[-#]?\\s*(\\d{1,4})\\b[^.;\\n]{0,60}?\\b${YEAR}\\b(?:[^.;\\n]{0,30}?\\b${MAKE})?`, "gi"),
  new RegExp(`\\b${YEAR}\\s+${MAKE}\\b[^.;\\n]{0,60}?\\b${UNIT}\\s*[-#]?\\s*(\\d{1,4})\\b`, "gi"),
];

export type Apparatus = { unit: string; year: number; make?: string; age: number; flag: "replace" | "reserve" | null; source_url: string; source_title: string; quote: string };

export function findApparatus(docs: { url: string; title: string; text: string }[], now = new Date().getFullYear()): Apparatus[] {
  const out = new Map<string, Apparatus>();
  for (const d of docs) {
    for (const [i, re] of PATTERNS.entries()) {
      for (const m of d.text.matchAll(re)) {
        const [type, num, year, make] = i === 0 ? [m[1], m[2], m[3], m[4]] : [m[3], m[4], m[1], m[2]];
        const y = Number(year);
        if (y < 1960 || y > now + 1) continue;
        const unit = `${type[0].toUpperCase()}${type.slice(1).toLowerCase()} ${num}`;
        if (out.has(unit)) continue;
        const age = now - y;
        out.set(unit, { unit, year: y, make, age, flag: age > REPLACE_AGE ? "replace" : age > RESERVE_AGE ? "reserve" : null, source_url: d.url, source_title: d.title, quote: m[0].trim() });
      }
    }
  }
  return [...out.values()].sort((a, b) => a.year - b.year);
}

export function apparatusFacts(units: Apparatus[]): Fact[] {
  return units.map((a) => ({
    text: `${a.unit}: ${a.year}${a.make ? ` ${a.make}` : ""}, ${a.age} years old${flagText(a.flag)}.`,
    source_url: a.source_url,
    source_title: a.source_title,
    quote: a.quote,
  }));
}

export function flagText(flag: Apparatus["flag"]) {
  if (flag === "replace") return ` (over ${REPLACE_AGE} years: NFPA 1911 recommends replacement)`;
  if (flag === "reserve") return ` (over ${RESERVE_AGE} years: NFPA 1911 recommends reserve status)`;
  return "";
}

/** One-line fleet summary for the "why call today" input, or null when no dated units were found. */
export function fleetSummary(units: Apparatus[]): string | null {
  if (!units.length) return null;
  const replace = units.filter((u) => u.flag === "replace").length;
  const reserve = units.filter((u) => u.flag === "reserve").length;
  const oldest = units[0];
  return `${units.length} dated unit${units.length === 1 ? "" : "s"} found; oldest is ${oldest.unit} (${oldest.year}). ${replace} past the ${REPLACE_AGE}-year replacement mark, ${reserve} past the ${RESERVE_AGE}-year reserve mark.`;
}
