# Fire Department Pre-Call Brief

Paste a Google Place ID for a fire department, get a one-page brief for an account executive. Every fact links to its source. Non-government places are rejected.

## How a brief is built

1. **Resolve the place.** Google Places API (New) gives name, address, phone, website, and types.
2. **Gate.** The place is matched against the U.S. Fire Administration National Fire Department Registry (snapshot in `data/usfa-registry.csv`, by phone first, then name and city). A registry match means it's a real fire agency. With no match, the place must be typed `fire_station` by Google and have a `.gov`, `.us`, `.org`, `.mil`, or `.edu` website, or no website. Everything else is rejected with a reason.
3. **Deterministic sources, in parallel** (about one second total):
   - USFA registry row: department type, stations, staffing.
   - USAspending.gov: AFG, SAFER, and Fire Prevention & Safety grants to the department or its city.
   - The department's own website: homepage plus pages that look like apparatus, leadership, budget, or news.
   - Learned sources: URLs that produced cited facts for this Place ID last time.
4. **One Claude call** writes the brief from that material and runs at most three web searches to fill gaps (chief, fleet, surplus listings, recent news). Output is validated JSON: sections of facts, each with a source URL.
5. **Remember.** Cited URLs are stored per Place ID, and their domains are counted so good sources get suggested on future runs.

## Guardrails

- **Validation.** A Place ID must match `[A-Za-z0-9_-]{10,300}` before any API call is made. Unknown IDs get a clear 404 from the Places lookup.
- **Concurrency.** At most five briefs are researched at once (`MAX_CONCURRENT_BRIEFS`). A sixth request gets a 429 with a plain-language message and a retry button; nothing is charged.
- **Brief cache.** A finished brief is served from cache for 24 hours (`BRIEF_TTL_SECONDS`). The page shows its age and a Refresh button that forces a live run.

All three share one key-value layer (`lib/utils/kv.ts`): Upstash Redis in production, an in-memory map persisted to `.cache/kv.json` locally.

## Run locally

```bash
cp .env.example .env.local   # add GOOGLE_PLACES_API_KEY and ANTHROPIC_API_KEY
npm install
npm run dev
```

The Google key needs the Places API (New) enabled.

## Layout

| File | Role |
|---|---|
| `app/page.tsx` | Input, loading, rejection, and brief views |
| `app/api/brief/route.ts` | The five steps above |
| `lib/validators/inputValidator.ts` | Place ID format check |
| `lib/validators/fireDepartmentValidator.ts` | USFA registry match and the government-agency check |
| `lib/informationFetchers/fetchGooglePlaceId.ts` | Google Places lookup |
| `lib/informationFetchers/fetchGrants.ts` | Federal grant lookup (USAspending) |
| `lib/informationFetchers/fetchDeptWebsites.ts` | Department website pages |
| `lib/informationFetchers/fetchFromClaude.ts` | The Claude call and output validation |
| `lib/buildFireDeptBrief.ts` | Builds the prompts and coverage block, then calls Claude |
| `lib/utils/kv.ts` | Key-value layer: Upstash Redis or local file |
| `lib/utils/cache.ts` | Brief cache and learned sources |
| `lib/utils/rateLimiter.ts` | Concurrency limit |
| `data/known-domains.json` | Seed list of useful and blocked domains |

## Refreshing the registry

```bash
curl -L https://apps.usfa.fema.gov/registry/api/download/national -o /tmp/national.csv
```

Then trim to the columns in `data/usfa-registry.csv` and update `data/usfa-registry.downloaded`.
