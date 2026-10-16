import fs from "node:fs";
import path from "node:path";

/**
 * Tiny key-value layer used by the brief cache, learned sources, and the concurrency limiter.
 * Upstash Redis over REST when UPSTASH_REDIS_REST_URL/TOKEN are set; otherwise an in-memory
 * map persisted to .cache/kv.json for local dev (one process, best effort).
 */
const PREFIX = "garage:";
const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

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

// ---- local fallback ----
type Entry = { v: unknown; exp?: number };
const FILE = path.join(process.cwd(), ".cache", "kv.json");
let mem: Map<string, Entry> | null = null;

function local(): Map<string, Entry> {
  if (mem) return mem;
  try {
    mem = new Map(Object.entries(JSON.parse(fs.readFileSync(FILE, "utf8"))));
  } catch {
    mem = new Map();
  }
  return mem;
}
function persist() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(Object.fromEntries(local())));
  } catch {}
}
function live(key: string): Entry | null {
  const e = local().get(key);
  if (!e) return null;
  if (e.exp && e.exp < Date.now()) {
    local().delete(key);
    return null;
  }
  return e;
}

export const kv = {
  async get<T>(key: string): Promise<T | null> {
    key = PREFIX + key;
    if (url) {
      const raw = (await redis("GET", key)) as string | null;
      return raw ? (JSON.parse(raw) as T) : null;
    }
    return (live(key)?.v as T) ?? null;
  },

  async set(key: string, value: unknown, ttlSec?: number): Promise<void> {
    key = PREFIX + key;
    if (url) {
      await (ttlSec ? redis("SET", key, JSON.stringify(value), "EX", ttlSec) : redis("SET", key, JSON.stringify(value)));
      return;
    }
    local().set(key, { v: value, exp: ttlSec ? Date.now() + ttlSec * 1000 : undefined });
    persist();
  },

  /** Atomic increment with a safety expiry so a crashed request can't hold a slot forever. */
  async incr(key: string, ttlSec: number): Promise<number> {
    key = PREFIX + key;
    if (url) {
      const n = (await redis("INCR", key)) as number;
      await redis("EXPIRE", key, ttlSec);
      return n;
    }
    const n = ((live(key)?.v as number) ?? 0) + 1;
    local().set(key, { v: n, exp: Date.now() + ttlSec * 1000 });
    return n;
  },

  async decr(key: string): Promise<void> {
    key = PREFIX + key;
    if (url) {
      const n = (await redis("DECR", key)) as number;
      if (n < 0) await redis("SET", key, 0);
      return;
    }
    const e = live(key);
    if (e) e.v = Math.max(0, (e.v as number) - 1);
  },

  /** Sorted-set counter, used for "which domains produce facts". */
  async zincr(key: string, member: string): Promise<void> {
    key = PREFIX + key;
    if (url) {
      await redis("ZINCRBY", key, 1, member);
      return;
    }
    const scores = (live(key)?.v as Record<string, number>) ?? {};
    scores[member] = (scores[member] ?? 0) + 1;
    local().set(key, { v: scores });
    persist();
  },

  async ztop(key: string, n: number): Promise<string[]> {
    key = PREFIX + key;
    if (url) return (await redis("ZREVRANGE", key, 0, n - 1)) as string[];
    const scores = (live(key)?.v as Record<string, number>) ?? {};
    return Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, n).map(([m]) => m);
  },
};
