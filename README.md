# Fire Department Pre-Call Brief

A one-page brief an account executive can read right before calling a fire department. Paste a Google Place ID and the site researches the department live, then shows who runs it, its funding, its fleet, recent activity, and a short "why call today". Every fact links to its source, with a verbatim quote and, when the source states one, a date.

## What it does

1. **Checks the place.** Looks up the Place ID with Google, then confirms it is a government fire department using the U.S. Fire Administration's national registry. Restaurants, businesses, and other non-agencies are rejected with a reason.
2. **Gathers information** from several sources at once:
   - the department's website, its town or county site, and the first page of Google results for the department, including pages listed in those sites' sitemaps (bid notices, vehicles for sale, rosters, officer lists)
   - federal fire grants from FEMA and USAspending
   - IRS Form 990 filings, for volunteer companies that are nonprofits
   - council and board records (Legistar, CivicPlus agendas)
3. **Writes the brief.** One Claude call reads everything gathered and writes the brief. If the chief, funding, or fleet is still missing, Claude searches the web for that item. A brief takes about 15 to 30 seconds, with a live progress bar.
4. **Checks every fact.** A fact must be stated directly by its source: its quote has to appear in the fetched page and contain every number in the fact. Unsupported facts are dropped, and a required section with nothing sourced says "Not found" and lists what was checked.
5. **Flags what matters to Garage.** Vehicles the department is selling (bid notices, surplus listings) lead the brief, and apparatus over 15 or 25 years old is flagged for reserve or replacement.
6. **Stores every version.** Each brief is saved by department and version. Searching a department again re-checks its records (registry, grants, 990s, meeting records) and its own website pages; if they match any stored version, that brief is shown instead of writing a duplicate. "View stored briefs" lists every department, searchable by name or Place ID, with all its versions.

Rate limited to 5 briefs built at once, extra requests are asked to try again shortly.

## Stack

- **Language:** TypeScript
- **Framework:** Next.js 15 (App Router) with React 19 and Tailwind CSS, deployed on Vercel
- **Database:** Supabase Postgres (`supabase/schema.sql`)
- **Dependencies:** `@anthropic-ai/sdk` (Claude), `@supabase/postgrest-js` (database), `pdfjs-dist` (PDF text), `zod` (validating Claude's output)
- **External services:** Google Places API, Anthropic API, Serper (Google search results), FEMA OpenFEMA, USAspending, ProPublica Nonprofit Explorer, Legistar; Upstash Redis optionally, for a global rate limit
- **Bundled data:** a snapshot of the USFA National Fire Department Registry (`data/usfa-registry.csv`)

### Running locally

```bash
cp .env.example .env.local   # fill in the keys below
npm install
npm run dev
```

Required: `GOOGLE_PLACES_API_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`. Recommended: `SERPER_API_KEY` (without it, Claude's web search stands in for Google results). Run `supabase/schema.sql` once in the Supabase SQL Editor.

## Code structure

```
app/
  page.tsx                       Home page: Place ID input, live progress, the brief
  stored-briefs/page.tsx         Stored departments, searchable by name or Place ID
  stored-briefs/[placeId]/       One department's versions
  components/BriefView.tsx       Renders a brief with its citations
  components/ProgressPanel.tsx   Progress bar and per-step status
  api/generate-brief/route.ts    The pipeline: validate, gather, compare, write, save (streams progress)
  api/stored-briefs/             Read-only endpoints for stored briefs
lib/
  buildFireDeptBrief.ts          Builds the prompts and coverage notes; required sections
  validators/inputValidator.ts   Place ID format, USFA registry match, government-agency gate
  gatherInformation/
    gatherEvidence.ts            Runs every fetcher in parallel
    fetchGooglePlaceId.ts        Google Places lookup
    fetchSearchResults.ts        First page of Google results (Serper, or Claude search)
    fetchDeptWebsites.ts         Picks crawl starts, sitemaps, and link priorities; ranks pages
    crawler.ts                   Best-first crawler, sitemap reader, HTML and PDF text
    fetchGrants.ts               FEMA and USAspending fire grants
    fetchNonprofitFinances.ts    IRS 990 filings via ProPublica
    fetchMeetingDocs.ts          Legistar and CivicPlus council records
  writeBrief/
    writeWithClaude.ts           The Claude call, streaming, output validation
    citations.ts                 Numbered sources and the quote, number, and date checks
  storeBrief/
    evidenceHash.ts              Fingerprint of the gathered evidence
    briefStore.ts                Supabase reads and writes
  utils/
    apparatusAge.ts              Dated apparatus and NFPA age flags
    progress.ts                  Progress steps and percentages
    rateLimiter.ts               Five-at-a-time limit (Redis or in memory)
    dataTypes.ts                 Shared types
data/                            USFA registry snapshot, domain hints for Claude's search
supabase/schema.sql              Database tables
```

## Known gaps

- **Facebook pages can't be read.** Many volunteer departments post most of their news there, but Facebook shows no posts without a login, and both open-source scraping libraries tested returned nothing. The routes that would work are Meta's Page Public Content Access API (requires Meta's app review) or a paid scraping service (Meta's terms prohibit it).
- **Apparatus extraction can mislabel units.** Model years are read from page text by pattern; on table layouts a year can be paired with the wrong unit name.
- **Coverage depends on what is online.** Small departments with no website and little press get thin briefs; a required section then says "Not found" rather than guessing.
- **The home page doesn't keep its state.** Leaving it mid-build (e.g. for "View stored briefs") clears the page; the brief still finishes and is saved under stored briefs.
- **Re-checks only see the department's own pages.** A new notice that appears only deeper in the site, or only in search results, doesn't trigger a new brief until something checked also changes.
- **Re-checks ignore pipeline improvements.** If a department's sources are unchanged, it keeps its stored brief even after the brief-writing logic improves.

## Future features

- **Other ways to look up a department.** Search by department name, town, or address instead of requiring a Google Place ID.
- **Sharing a brief.** A link to a specific brief version that a teammate can open directly.
- **Google Maps link.** Each stored brief links back to the department on Google Maps.
