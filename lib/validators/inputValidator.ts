import fs from "node:fs";
import path from "node:path";
import type { Fact, Place, RegistryEntry } from "../utils/dataTypes";

/**
 * Input validation, in the order a request meets it:
 *  1. validatePlaceId: is the input a well-formed Google Place ID? (before any API call)
 *  2. validateFireDepartment: is the place a government fire department? (after the Places lookup)
 *
 * Is this place a government fire department?
 *
 * Two parts: the U.S. Fire Administration National Fire Department Registry (match, facts),
 * and the validation rule that uses the match plus Google place types and website domain.
 *
 * Registry source: https://apps.usfa.fema.gov/registry/
 * Snapshot CSV lives in data/ (see data/usfa-registry.downloaded for the date).
 */

let rows: RegistryEntry[] | null = null;

function load(): RegistryEntry[] {
  if (rows) return rows;
  const file = path.join(process.cwd(), "data", "usfa-registry.csv");
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(",");
  rows = lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const r: Record<string, string> = {};
    header.forEach((h, i) => (r[h] = cols[i] ?? ""));
    return r as RegistryEntry;
  });
  return rows;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export function registryDate(): string {
  try {
    return fs
      .readFileSync(path.join(process.cwd(), "data", "usfa-registry.downloaded"), "utf8")
      .trim();
  } catch {
    return "unknown";
  }
}

const digits = (s: string) => s.replace(/\D/g, "").slice(-10);
const STOP = new Set(["fire", "department", "dept", "district", "company", "co", "of", "the", "and", "station", "rescue", "ems", "volunteer", "protection", "fd"]);
const tokens = (s: string) =>
  new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t && !STOP.has(t)));

/** Match a Google place to a registry row: phone first, then name + city/zip in the same state. */
export function findRegistryEntry(place: Place): RegistryEntry | null {
  const all = load();
  const phone = digits(place.phone);
  if (phone.length === 10) {
    const hit = all.find((r) => digits(r.phone) === phone);
    if (hit) return hit;
  }

  const want = tokens(place.name);
  const city = place.city.toLowerCase();
  let best: RegistryEntry | null = null;
  let bestScore = 0;
  for (const r of all) {
    if (r.state !== place.state) continue;
    const sameCity = r.city.toLowerCase() === city || (place.zip && r.zip === place.zip.slice(0, 5));
    if (!sameCity) continue;
    const have = tokens(r.name);
    let overlap = 0;
    for (const t of want) if (have.has(t)) overlap++;
    const score = overlap / Math.max(1, Math.max(want.size, have.size));
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  // A city-only name like "Ithaca Fire Department" has one real token; require it to match.
  return bestScore >= 0.5 ? best : null;
}

export function registryFacts(r: RegistryEntry): Fact[] {
  const url = "https://apps.usfa.fema.gov/registry/";
  const title = "USFA National Fire Department Registry";
  const meta = { source_url: url, source_title: title, source_type: "USFA registry", date: registryDate(), date_label: "Registry snapshot" };
  const staff = [
    r.career !== "0" && `${r.career} career`,
    r.volunteer !== "0" && `${r.volunteer} volunteer`,
    r.paid_per_call !== "0" && `${r.paid_per_call} paid-per-call`,
  ]
    .filter(Boolean)
    .join(", ");
  return [
    { text: `${r.dept_type} department, ${r.org_type.toLowerCase()} government organization (FDID ${r.fdid}).`, ...meta },
    { text: `${r.stations} station${r.stations === "1" ? "" : "s"}; active firefighters: ${staff || "not reported"}.`, ...meta },
  ];
}

// ---- validation ----

const PUBLIC_TLDS = [".gov", ".us", ".org", ".mil", ".edu"];

/** Returns a rejection reason, or null if the place is a government fire agency. */
export function validateFireDepartment(place: Place, registry: RegistryEntry | null): string | null {
  if (registry) {
    if (/^private/i.test(registry.org_type)) {
      return `The USFA registry lists "${registry.name}" as a private or industrial fire brigade, not a government agency.`;
    }
    return null;
  }

  const fireLike =
    place.types.includes("fire_station") || /\b(fire|fd)\b/i.test(place.name);
  if (!fireLike) {
    const kind = place.types.find((t) => t !== "point_of_interest" && t !== "establishment") ?? "place";
    return `"${place.name}" is listed by Google as a ${kind.replace(/_/g, " ")}, not a fire department, and does not appear in the USFA fire department registry.`;
  }

  if (place.website) {
    const host = new URL(place.website).hostname.toLowerCase();
    if (!PUBLIC_TLDS.some((t) => host.endsWith(t))) {
      return `"${place.name}" is not in the USFA fire department registry and its website (${host}) is not a government or nonprofit domain, so it looks like a private business.`;
    }
  }
  return null;
}

// ---- Place ID format ----

/** Google Place IDs are URL-safe base64-ish tokens; reject anything else before spending an API call. */
const PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;

export function validatePlaceId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  return PLACE_ID.test(id) ? id : null;
}
