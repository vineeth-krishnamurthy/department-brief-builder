import type { Fact, Place } from "../utils/dataTypes";

/**
 * IRS Form 990 filings via ProPublica Nonprofit Explorer (free, no key).
 * Volunteer fire companies are usually nonprofits, so this covers funding for
 * exactly the departments that USAspending and city budgets miss.
 * Returns null when the lookup could not run, [] when no matching nonprofit was found.
 */
const API = "https://projects.propublica.org/nonprofits/api/v2";

// Words that don't identify a specific department, and orgs that are related but separate.
const GENERIC = new Set(["fire", "department", "dept", "company", "co", "inc", "volunteer", "vol", "the", "of", "and", "district", "station", "rescue", "ems", "corporation", "corp"]);
const SEPARATE_ORG = /auxiliary|ladies|benevolent|association|union|local \d|relief|foundation|explorers|alumni|trust/i;

type Org = { ein: number; name: string; city: string; state: string };
type Filing = { tax_prd_yr: number; totrevenue: number; totfuncexpns: number; totassetsend: number };

const words = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w && !GENERIC.has(w));

export async function nonprofitFacts(place: Place): Promise<Fact[] | null> {
  if (!place.state) return null;
  try {
    // ProPublica requires every query word to appear, so search distinctive words only ("Co" vs "Company" would miss).
    const want = words(place.name);
    if (want.length === 0) return [];
    const q = encodeURIComponent(`${want.join(" ")} fire`);
    const search = await fetch(`${API}/search.json?q=${q}&state%5Bid%5D=${place.state}`, { signal: AbortSignal.timeout(6000) });
    if (search.status === 404) return []; // ProPublica answers "no results" with a 404
    if (!search.ok) return null;
    const { organizations = [] } = (await search.json()) as { organizations?: Org[] };

    // Every distinctive word of the department's name must appear in the nonprofit's name,
    // and a county-level org doesn't count for a city or company department.
    const wantsCounty = want.includes("county");
    const org = organizations.find((o) => {
      const have = new Set(words(o.name));
      return (
        !SEPARATE_ORG.test(o.name) &&
        /fire/i.test(o.name) &&
        want.every((w) => have.has(w)) &&
        (wantsCounty || !have.has("county"))
      );
    });
    if (!org) return [];

    const detail = await fetch(`${API}/organizations/${org.ein}.json`, { signal: AbortSignal.timeout(6000) });
    if (!detail.ok) return null;
    const { filings_with_data = [] } = (await detail.json()) as { filings_with_data?: Filing[] };
    const filings = filings_with_data.filter((f) => f.totrevenue != null).slice(0, 3);
    if (filings.length === 0) return [];

    const url = `https://projects.propublica.org/nonprofits/organizations/${org.ein}`;
    const title = "IRS Form 990 via ProPublica";
    const $ = (n: number) => `$${Math.round(n).toLocaleString()}`;
    const facts: Fact[] = filings.map((f) => ({
      text: `Tax year ${f.tax_prd_yr}: revenue ${$(f.totrevenue)}, expenses ${$(f.totfuncexpns)}, assets ${$(f.totassetsend)} (${titleCase(org.name)}).`,
      source_url: url,
      source_title: title,
      source_type: "IRS Form 990",
      date: String(f.tax_prd_yr),
      date_label: "Tax year",
    }));

    // Trend across filings, newest first in the array.
    if (filings.length >= 2) {
      const deficits = filings.filter((f) => f.totfuncexpns > f.totrevenue).length;
      const newest = filings[0], oldest = filings[filings.length - 1];
      const assetChange = (newest.totassetsend - oldest.totassetsend) / Math.max(1, oldest.totassetsend);
      if (deficits === filings.length || assetChange <= -0.1) {
        const parts = [
          deficits === filings.length && `expenses exceeded revenue in each of the last ${filings.length} filings`,
          assetChange <= -0.1 && `assets fell ${Math.round(-assetChange * 100)}% from ${$(oldest.totassetsend)} (${oldest.tax_prd_yr}) to ${$(newest.totassetsend)} (${newest.tax_prd_yr})`,
        ].filter(Boolean);
        facts.unshift({
          text: `Finances are tightening: ${parts.join(", and ")}.`, source_url: url, source_title: title,
          source_type: "IRS Form 990", date: `${oldest.tax_prd_yr}–${newest.tax_prd_yr}`, date_label: "Tax years",
        });
      }
    }
    return facts;
  } catch {
    return null;
  }
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
