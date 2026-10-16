"use client";

import { useState } from "react";
import type { Brief, Rejection } from "@/lib/utils/dataTypes";

export default function Home() {
  const [placeId, setPlaceId] = useState("");
  const [loading, setLoading] = useState(false);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [rejection, setRejection] = useState<Rejection | null>(null);
  const [error, setError] = useState<{ message: string; busy: boolean } | null>(null);
  const [lastId, setLastId] = useState("");

  async function run(id = placeId, refresh = false) {
    setLoading(true);
    setBrief(null);
    setRejection(null);
    setError(null);
    setLastId(id);
    try {
      const res = await fetch("/api/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId: id, refresh }),
      });
      const data = await res.json();
      if (res.status === 422) setRejection(data);
      else if (!res.ok) setError({ message: data.error ?? "Something went wrong", busy: res.status === 429 });
      else setBrief(data);
    } catch (e) {
      setError({ message: (e as Error).message, busy: false });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Fire Department Pre-Call Brief</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Paste a Google Place ID. Every fact links to where it came from.
        </p>
      </header>

      <form
        onSubmit={(e) => { e.preventDefault(); run(); }}
        className="flex gap-2"
      >
        <input
          value={placeId}
          onChange={(e) => setPlaceId(e.target.value)}
          placeholder="ChIJ..."
          className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="submit"
          disabled={loading || !placeId.trim()}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-black"
        >
          {loading ? "Researching…" : "Build brief"}
        </button>
      </form>

      {loading && (
        <p className="mt-8 animate-pulse text-sm text-neutral-500">
          Looking up the place, checking the USFA registry and federal grants, reading the department site, then filling gaps…
        </p>
      )}

      {error && (
        <div
          className={`mt-8 rounded-md border p-4 text-sm ${
            error.busy ? "border-sky-300 bg-sky-50 text-sky-900" : "border-red-300 bg-red-50 text-red-800"
          }`}
        >
          <p>{error.message}</p>
          {error.busy && (
            <button onClick={() => run(lastId)} className="mt-2 rounded-md border border-sky-400 px-3 py-1 text-xs font-medium">
              Try again
            </button>
          )}
        </div>
      )}

      {rejection && (
        <div className="mt-8 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">Not a government fire agency</p>
          <p className="mt-1">{rejection.reason}</p>
          {rejection.place && <p className="mt-2 text-xs text-amber-700">{rejection.place.name} · {rejection.place.address}</p>}
        </div>
      )}

      {brief && (
        <>
          {brief.cached && (
            <div className="mt-8 flex items-center justify-between rounded-md border border-neutral-200 bg-neutral-50 px-4 py-2 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
              <span>Cached brief from {age(brief.generated_at)}. Research is not live.</span>
              <button onClick={() => run(brief.place.id, true)} className="rounded-md border border-neutral-400 px-3 py-1 font-medium">
                Refresh now
              </button>
            </div>
          )}
          <BriefView brief={brief} />
        </>
      )}
    </main>
  );
}

function BriefView({ brief }: { brief: Brief }) {
  const { place, registry } = brief;
  return (
    <article className="mt-8">
      <div className="border-b border-neutral-200 pb-4 dark:border-neutral-800">
        <h2 className="text-xl font-semibold">{place.name}</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{place.address}</p>
        <p className="mt-1 text-sm">
          {place.phone && <span className="mr-4">{place.phone}</span>}
          {place.website && (
            <a href={place.website} target="_blank" rel="noreferrer" className="underline">
              {new URL(place.website).hostname}
            </a>
          )}
        </p>
        {registry && (
          <p className="mt-2 text-xs text-neutral-500">
            USFA registry: {registry.dept_type}, {registry.stations} station{registry.stations === "1" ? "" : "s"},{" "}
            {registry.career} career / {registry.volunteer} volunteer (snapshot {brief.registry_date})
          </p>
        )}
      </div>

      <div className="mt-4 rounded-md bg-neutral-100 p-4 text-sm dark:bg-neutral-900">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Why call today</p>
        <p>{brief.why_call_today}</p>
      </div>

      {brief.sections.map((s) => (
        <section key={s.title} className="mt-6">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{s.title}</h3>
          <ul className="space-y-2 text-sm">
            {s.facts.map((f, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-neutral-400">•</span>
                <span>
                  {f.text}{" "}
                  <a
                    href={f.source_url}
                    target="_blank"
                    rel="noreferrer"
                    title={f.source_url}
                    className="whitespace-nowrap text-xs text-blue-700 underline dark:text-blue-400"
                  >
                    {f.source_title || hostOf(f.source_url)}
                  </a>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <p className="mt-8 text-xs text-neutral-400">
        Generated {new Date(brief.generated_at).toLocaleString()} in {(brief.elapsed_ms / 1000).toFixed(1)}s
      </p>
    </article>
  );
}

function age(iso: string) {
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}
