"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { DepartmentRow, StoredVersion, VersionRow } from "@/lib/utils/briefStore";
import { BriefView } from "../../components/BriefView";

/** One department: every stored version, newest first, with the selected version's brief. */
export default function DepartmentBriefs() {
  const { placeId } = useParams<{ placeId: string }>();
  const [dept, setDept] = useState<DepartmentRow | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [brief, setBrief] = useState<StoredVersion | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/briefs/${encodeURIComponent(placeId)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not load stored briefs.");
        setDept(data.department);
        setVersions(data.versions);
        setSelected(data.versions[0]?.version ?? null);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [placeId]);

  useEffect(() => {
    if (selected === null) return;
    setBrief(null);
    (async () => {
      try {
        const res = await fetch(`/api/briefs/${encodeURIComponent(placeId)}/${selected}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not load the brief.");
        setBrief(data);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [placeId, selected]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <Link href="/briefs" className="text-sm text-neutral-500 underline">← All stored briefs</Link>
      {error && <p className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">{error}</p>}

      {dept && (
        <>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">{dept.name}</h1>
          <p className="text-sm text-neutral-500">{dept.address}</p>
          <p className="mt-1 font-mono text-xs text-neutral-400">{dept.place_id}</p>

          <div className="mt-6 grid gap-6 md:grid-cols-[200px_1fr]">
            <nav aria-label="Versions">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Versions</p>
              <ul className="mt-2 space-y-1">
                {versions.map((v) => (
                  <li key={v.version}>
                    <button
                      onClick={() => setSelected(v.version)}
                      className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
                        v.version === selected ? "bg-neutral-900 text-white dark:bg-white dark:text-black" : "hover:bg-neutral-100 dark:hover:bg-neutral-900"
                      }`}
                    >
                      Version {v.version}
                      <span className="block text-xs opacity-70">{new Date(v.created_at).toLocaleString()}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="min-w-0">
              {brief ? <BriefView brief={brief.brief} /> : !error && <p className="text-sm text-neutral-500">Loading…</p>}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
