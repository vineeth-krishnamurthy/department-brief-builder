/**
 * Concurrency limit: at most MAX briefs being researched at once.
 *
 * The in-flight counter lives in Upstash Redis when UPSTASH_REDIS_REST_URL/TOKEN are set,
 * so the limit is global across server instances. Without them it is kept in memory,
 * so the limit applies per server instance.
 */
const MAX = Number(process.env.MAX_CONCURRENT_BRIEFS ?? 5);
const SLOT_TTL = 90; // seconds; a crashed request releases its slot after this
const KEY = "garage:inflight";

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!(url && token) && process.env.VERCEL) {
  console.warn("[rate limit] UPSTASH_REDIS_REST_URL/TOKEN not set: the concurrency limit applies per server instance, not globally.");
}

export class BusyError extends Error {
  status = 429;
  constructor() {
    super(`The service is busy right now. It handles ${MAX} briefs at a time. Please try again in a few seconds.`);
  }
}

/** Take a slot or throw BusyError. Returns the release function; call it exactly once. */
export async function acquireSlot(): Promise<() => Promise<void>> {
  const n = await incrInflight();
  if (n > MAX) {
    await decrInflight();
    throw new BusyError();
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await decrInflight();
  };
}

export async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  const release = await acquireSlot();
  try {
    return await fn();
  } finally {
    await release();
  }
}

// ---- in-flight counter ----

let local = 0;
let localExpires = 0;

async function redis(...cmd: (string | number)[]): Promise<unknown> {
  const res = await fetch(url!, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
    signal: AbortSignal.timeout(3000),
  });
  const data = (await res.json()) as { result?: unknown; error?: string };
  if (data.error) throw new Error(`redis: ${data.error}`);
  return data.result;
}

/** Atomic increment with a safety expiry so a crashed request can't hold a slot forever. */
async function incrInflight(): Promise<number> {
  if (url && token) {
    const n = (await redis("INCR", KEY)) as number;
    await redis("EXPIRE", KEY, SLOT_TTL);
    return n;
  }
  if (Date.now() > localExpires) local = 0;
  localExpires = Date.now() + SLOT_TTL * 1000;
  return ++local;
}

async function decrInflight(): Promise<void> {
  if (url && token) {
    const n = (await redis("DECR", KEY)) as number;
    if (n < 0) await redis("SET", KEY, 0);
    return;
  }
  local = Math.max(0, local - 1);
}

/** Current count; used by tests and diagnostics. */
export async function inflight(): Promise<number> {
  if (url && token) return Number((await redis("GET", KEY)) ?? 0);
  return Date.now() > localExpires ? 0 : local;
}
