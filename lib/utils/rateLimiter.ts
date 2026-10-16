import { kv } from "./kv";

/** Global concurrency limit: at most MAX briefs being researched at once. */
const MAX = Number(process.env.MAX_CONCURRENT_BRIEFS ?? 5);
const SLOT_TTL = 90; // seconds; a crashed request releases its slot after this

export class BusyError extends Error {
  status = 429;
  constructor() {
    super(`The service is busy right now. It handles ${MAX} briefs at a time. Please try again in a few seconds.`);
  }
}

export async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  const n = await kv.incr("inflight", SLOT_TTL);
  if (n > MAX) {
    await kv.decr("inflight");
    throw new BusyError();
  }
  try {
    return await fn();
  } finally {
    await kv.decr("inflight");
  }
}
