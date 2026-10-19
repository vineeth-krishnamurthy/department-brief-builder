# Fire Department Pre-Call Brief

Paste a Google Place ID for a fire department, get a one-page brief for an account executive. Every fact links to its source. Non-government places are rejected.

## How a brief is built

The goal is one Claude call fed with as much raw, sourced material as possible, so Claude reads
and writes rather than searches. Claude gets search tools only when a required item is still
missing after gathering, and must then search for each missing item. A brief targets under 60 seconds.

1. **Resolve the place.** Google Places API (New) gives name, address, phone, website, and types.
2. **Gate.** The place is matched against the U.S. Fire Administration National Fire Department Registry (snapshot in `data/usfa-registry.csv`, by phone first, then name and city). A registry match means it's a real fire agency. With no match, the place must be typed `fire_station` by Google and have a `.gov`, `.us`, `.org`, `.mil`, or `.edu` website, or no website. Everything else is rejected with a reason.
3. **Gather, all in parallel, about 3 to 4 seconds total.** Each source has its own deadline and reports "found", "nothing", or "failed" separately.
   - **USFA registry row**: department type, stations, staffing.
   - **Federal fire grants**: FEMA's own award list (OpenFEMA) merged with USAspending.gov, for AFG, SAFER, and Fire Prevention & Safety since 2015. Neither carries an FDID, so the join is on recipient name and location, and a recipient must look like a fire organization or the town's own government ("ITHACA, CITY OF").
   - **IRS Form 990 filings** (ProPublica) for volunteer companies and other nonprofits: revenue, expenses, assets, and the trend.
   - **Web search**: the first page of results for "<department> <town> <state>". Google results via Serper when `SERPER_API_KEY` is set, otherwise Claude's web search (only the result URLs are used). This finds the town's own site, directory listings, and bid notices that Google Places doesn't link to.
   - **Website crawl**: the department's site (and its parent city or county site), two levels deep, plus the search results as extra seeds. The department's site and official result sites also contribute the best pages from their sitemaps, so notices that aged off a list (a tanker for sale, a bid request) are still found. Links are fetched best-first: vehicles and their sale (tanker, engine, surplus, for sale) first, then leadership and money, then everything else; generic road and bridge RFPs rank low. Up to 50 documents in 15 seconds; the 30 most useful go to Claude, favoring vehicle sales, rosters with dated apparatus, and pages naming the chief. Official-looking results (a `.gov`/`.us` site or a domain containing the town's name) get one level of links followed; third-party sites are read but not followed. A search-result page is kept only if it mentions both the town and the state. Links about leadership, fleet, money, bids, agendas, minutes, boards, and transparency are followed. HTML pages and PDFs (via pdf.js) are read as text.
   - **Council and board records**: checked on the department's site and the hosts search found. Legistar's public API (a Granicus product) when the city is on it, and CivicPlus AgendaCenter agendas and minutes that mention the fire department. Other platforms (Granicus meeting portals, iQM2, BoardDocs, PrimeGov) are reached only when a city page links to them; their own listing pages proved too thin or too inconsistent to query directly. Municode was evaluated and left out: codified ordinances carry no dates, amounts, or names that help a call.
4. **Derive.** Every document is scanned for apparatus with model years. Each unit gets an NFPA 1911 age flag: over 15 years, reserve status; over 25 years, replacement. Social page links found on the site are kept for the AE to open; Facebook serves no content without a login, so it is not read.
5. **Compare with the stored briefs.** Everything gathered is hashed (SHA-256), with repeated menu and footer text stripped from pages first. If the hash matches the department's latest stored version, nothing changed: the page says so, shows the stored brief, and Claude is not called.
6. **One Claude call** reads all of it (raw documents under a 90,000-character budget) and writes the brief as validated JSON: sections of facts, each with a source URL.
   Sections, in order: Leadership, Funding & Grants, Fleet (vehicles only), Recent News (dated events only), and Miscellaneous (department profile: type, stations, staffing, call volume, coverage, ISO rating, history).
   Leadership and Funding & Grants are required sections. When either comes back empty, the brief says "Not found" and lists what was checked, so the AE knows to ask on the call.

## Stored briefs

Every brief for a valid fire department is kept in Supabase Postgres, one row per version. A new version is stored only when the gathered evidence differs from the latest version; rejected places and failed runs are never stored.

- **Tables** (`supabase/schema.sql`): `departments`, one row per Google Place ID, and `brief_versions`, with the brief as JSON and its evidence hash. Row-level security is on with no policies, so only the server's secret key can read or write.
- **Pages:** "View stored briefs" on the home page lists every department, searchable by name or Place ID. Each department's page shows every version, newest first.
- **Progress:** the brief route streams newline-delimited JSON progress events, so the page shows a live bar and one line per source. The Claude step streams too, so the bar moves while the brief is written.
- **Known limits:** a source that fails once, or a slow site that the crawler reads only partly, changes the hash and creates an extra version. Nothing is lost; it just stores a near-duplicate.

## Citations

Every fact shows where it came from: a source type and publisher, a date when the source states one, a verbatim quote, and a link.

- **Numbered sources.** Everything gathered becomes a source with an ID: structured records (R), headlines (H), and crawled documents (D). Claude cites one source ID per fact and, for documents, copies a quote of at most 30 words.
- **The server fills in the rest.** Link, source type, and date come from what the fetcher recorded, never from Claude. A fact citing an unknown ID is dropped.
- **Direct quotes only.** A fact citing a document must carry a quote that appears in the fetched text (ignoring case and punctuation), and every number in the fact must appear in that quote. If Claude quoted too narrowly (a table row's specs without its unit name), the server widens the quote to the surrounding verbatim words, up to about 40, when that span contains every number; otherwise the fact is dropped. Each dropped fact is logged with its reason. Facts citing records or headlines must have every number appear in that record or headline. A fact that fails either check is dropped, not shown without support.
- **Dates only when the source states them:** award start (USAspending), fiscal year (FEMA), tax year (IRS 990), meeting or introduction date (agendas, Legistar), snapshot date (registry). Web pages get no date.
- **Deep links.** HTML quotes link with a text fragment, so the browser scrolls to and highlights the quoted sentence.
- **Claude's own search.** A fact from Claude's gap-filling search is kept only if the URL appeared in its search results and the quote comes from a page it fetched.

## Guardrails

- **Validation.** A Place ID must match `[A-Za-z0-9_-]{10,300}` before any API call is made. Unknown IDs get a clear 404 from the Places lookup.
- **Concurrency.** At most five briefs are researched at once (`MAX_CONCURRENT_BRIEFS`). A sixth request gets a 429 with a plain-language message and a retry button; nothing is charged.

The concurrency counter lives in Upstash Redis when it is configured, so the limit is global; otherwise it is kept in memory per server instance (`lib/utils/rateLimiter.ts`).

## Run locally

```bash
cp .env.example .env.local   # add GOOGLE_PLACES_API_KEY and ANTHROPIC_API_KEY
npm install
npm run dev
```

The Google key needs the Places API (New) enabled.

## Layout

| Path | Role |
|---|---|
| `app/page.tsx` | Home page: Place ID input, live progress, and the result |
| `app/stored-briefs/` | Pages: stored-briefs list (`/stored-briefs`) and one department's versions (`/stored-briefs/<Place ID>`) |
| `app/api/generate-brief/route.ts` | Endpoint that builds a brief and streams progress |
| `app/api/stored-briefs/` | Read-only endpoints: search stored departments, list versions, fetch one version |
| `app/components/` | Shared UI: the brief view and the progress panel |
| `lib/buildFireDeptBrief.ts` | Entry point: builds the prompt and coverage block, has Claude write, enforces required sections |
| `lib/brief/writeWithClaude.ts` | The Claude call, streaming progress, and gap-filling search |
| `lib/brief/citations.ts` | Numbered sources, direct-quote and number checks, quote widening, dates, deep links |
| `lib/brief/evidenceHash.ts` | Fingerprint of the gathered evidence, deciding whether a new brief is needed |
| `lib/brief/progress.ts` | Weighted progress steps streamed to the page |
| `lib/informationFetchers/gatherEvidence.ts` | Runs every fetcher in parallel and reports progress |
| `lib/informationFetchers/crawler.ts` | Best-first crawler, sitemap reader, HTML and PDF text extraction |
| `lib/informationFetchers/fetchGooglePlaceId.ts` | Google Places lookup |
| `lib/informationFetchers/fetchSearchResults.ts` | First page of web search results (Serper or Claude web search) |
| `lib/informationFetchers/fetchDeptWebsites.ts` | Crawl seeds, sitemaps, link priorities, and document ranking |
| `lib/informationFetchers/fetchGrants.ts` | FEMA award list + USAspending, merged |
| `lib/informationFetchers/fetchNonprofitFinances.ts` | IRS Form 990 finances (ProPublica) |
| `lib/informationFetchers/fetchMeetingDocs.ts` | Legistar API and CivicPlus AgendaCenter records |
| `lib/informationFetchers/fetchSocial.ts` | Social page links found on the department's site |
| `lib/extractors/apparatusAge.ts` | Apparatus year extraction and NFPA age flags |
| `lib/storage/briefStore.ts` | Supabase reads and writes for departments and versions |
| `lib/validators/inputValidator.ts` | Place ID format check |
| `lib/validators/fireDepartmentValidator.ts` | USFA registry match and the government-agency check |
| `lib/utils/rateLimiter.ts` | Five-request concurrency limit and its counter |
| `lib/utils/dataTypes.ts` | Shared types |
| `data/usfa-registry.csv` | USFA registry snapshot (date in `usfa-registry.downloaded`) |
| `data/known-domains.json` | Domain hints for Claude's gap-filling search |
| `supabase/schema.sql` | Database setup script |

## Refreshing the registry

```bash
curl -L https://apps.usfa.fema.gov/registry/api/download/national -o /tmp/national.csv
```

Then trim to the columns in `data/usfa-registry.csv` and update `data/usfa-registry.downloaded`.
