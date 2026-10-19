"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { DepartmentRow } from "@/lib/utils/briefStore";

/** Every department with a stored brief, searchable by name or Google Place ID. */
export default function StoredBriefs() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<DepartmentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/briefs?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not load stored briefs.");
        setRows(data.departments);
        setError(null);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      }
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/" className="text-sm text-neutral-500 underline">← Build a brief</Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Stored briefs</h1>
      <p className="mt-1 text-sm text-neutral-500">Every brief built for a fire department, kept by version.</p>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by department name or Google Place ID"
        className="mt-6 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900"
      />

      {error && <p className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
      {rows && rows.length === 0 && !error && (
        <p className="mt-6 text-sm text-neutral-500">{q ? "No stored briefs match that search." : "No briefs stored yet."}</p>
      )}

      <ul className="mt-6 divide-y divide-neutral-200 dark:divide-neutral-800">
        {rows?.map((d) => (
          <li key={d.place_id}>
            <Link href={`/briefs/${encodeURIComponent(d.place_id)}`} className="block py-3 hover:bg-neutral-50 dark:hover:bg-neutral-900">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-medium">{d.name}</span>
                <span className="shrink-0 text-xs text-neutral-500">
                  {d.latest_version} version{d.latest_version === 1 ? "" : "s"}
                </span>
              </div>
              <p className="text-xs text-neutral-500">{d.address}</p>
              <p className="mt-0.5 text-xs text-neutral-400">
                Last checked {new Date(d.last_checked).toLocaleDateString()} · <span className="font-mono">{d.place_id}</span>
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
