"use client";

import Link from "next/link";
import { useState } from "react";
import type { Brief, BriefEvent, Place } from "@/lib/utils/dataTypes";
import type { Step } from "@/lib/utils/progress";
import { BriefView } from "./components/BriefView";
import { ProgressPanel } from "./components/ProgressPanel";

type Outcome =
  | { kind: "brief"; brief: Brief }
  | { kind: "unchanged"; message: string; brief: Brief }
  | { kind: "rejected"; reason: string; place: Place }
  | { kind: "error"; message: string; busy?: boolean };

export default function Home() {
  const [placeId, setPlaceId] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ pct: number; steps: Step[] } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [lastId, setLastId] = useState("");

  async function run(id = placeId) {
    setLoading(true);
    setOutcome(null);
    setProgress({ pct: 0, steps: [] });
    setLastId(id);
    try {
      const res = await fetch("/api/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId: id.trim() }),
      });
      // Bad input and a full service come back as plain JSON before any streaming.
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setOutcome({ kind: "error", message: data.error ?? `Request failed (${res.status})`, busy: res.status === 429 });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const e = JSON.parse(line) as BriefEvent;
          if (e.type === "progress") setProgress({ pct: e.pct, steps: e.steps });
          else {
            finished = true;
            if (e.type === "result") setOutcome({ kind: "brief", brief: e.brief });
            else if (e.type === "unchanged") setOutcome({ kind: "unchanged", message: e.message, brief: e.brief });
            else if (e.type === "rejected") setOutcome({ kind: "rejected", reason: e.reason, place: e.place });
            else setOutcome({ kind: "error", message: e.message });
          }
        }
      }
      if (!finished) setOutcome({ kind: "error", message: "The connection closed before the brief finished. Please try again." });
    } catch (e) {
      setOutcome({ kind: "error", message: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  const storage = outcome?.kind === "brief" ? outcome.brief.storage : undefined;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fire Department Pre-Call Brief</h1>
          <p className="mt-1 text-sm text-neutral-500">Paste a Google Place ID. Every fact links to where it came from.</p>
        </div>
        <Link
          href="/briefs"
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-900"
        >
          View stored briefs
        </Link>
      </header>

      <form onSubmit={(e) => { e.preventDefault(); run(); }} className="flex gap-2">
        <input
          value={placeId}
          onChange={(e) => setPlaceId(e.target.value)}
          placeholder="ChIJ..."
          className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="submit"
          disabled={loading || !placeId.trim()}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
        >
          {loading ? "Researching…" : "Build brief"}
        </button>
      </form>

      {loading && progress && <ProgressPanel pct={progress.pct} steps={progress.steps} />}

      {outcome?.kind === "error" && (
        <div className={`mt-6 rounded-md border p-4 text-sm ${outcome.busy ? "border-sky-300 bg-sky-50 text-sky-900" : "border-red-300 bg-red-50 text-red-800"}`}>
          <p>{outcome.message}</p>
          {outcome.busy && (
            <button onClick={() => run(lastId)} className="mt-2 rounded-md border border-sky-400 px-3 py-1 text-xs font-medium">
              Try again
            </button>
          )}
        </div>
      )}

      {outcome?.kind === "rejected" && (
        <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">Not a government fire agency</p>
          <p className="mt-1">{outcome.reason}</p>
          <p className="mt-2 text-xs text-amber-700">{outcome.place.name} · {outcome.place.address}</p>
        </div>
      )}

      {outcome?.kind === "unchanged" && (
        <>
          <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">No new information, so no new brief was created</p>
            <p className="mt-1">{outcome.message}</p>
            <Link href={`/briefs/${encodeURIComponent(outcome.brief.place.id)}`} className="mt-2 inline-block text-xs font-medium underline">
              See every version for this department
            </Link>
          </div>
          <BriefView brief={outcome.brief} />
        </>
      )}

      {outcome?.kind === "brief" && (
        <>
          {storage?.status === "new" && (
            <p className="mt-6 text-xs text-neutral-500">
              Saved as version {storage.version}.{" "}
              <Link href={`/briefs/${encodeURIComponent(outcome.brief.place.id)}`} className="underline">
                See every version
              </Link>
            </p>
          )}
          {storage?.status === "not_saved" && <p className="mt-6 text-xs text-amber-700">Not saved: {storage.reason}</p>}
          <BriefView brief={outcome.brief} />
        </>
      )}
    </main>
  );
}
