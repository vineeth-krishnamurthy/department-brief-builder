import type { Step } from "@/lib/utils/progress";

const ICON: Record<Step["status"], string> = { pending: "○", running: "◐", done: "✓", failed: "✕", skipped: "–" };
const TONE: Record<Step["status"], string> = {
  pending: "text-neutral-400",
  running: "text-blue-700 dark:text-blue-400",
  done: "text-emerald-700 dark:text-emerald-400",
  failed: "text-red-700 dark:text-red-400",
  skipped: "text-neutral-400",
};

/** Live progress: an overall bar plus one line per source, updated as each finishes. */
export function ProgressPanel({ pct, steps }: { pct: number; steps: Step[] }) {
  return (
    <div className="mt-6 rounded-md border border-neutral-200 p-4 dark:border-neutral-800">
      <div className="flex items-center justify-between text-xs text-neutral-500">
        <span>Researching</span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      <div
        className="mt-1 h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="h-full rounded-full bg-blue-600 transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
      </div>
      <ul className="mt-3 space-y-1 text-xs">
        {steps.map((s) => (
          <li key={s.id} className="flex gap-2">
            <span className={`w-3 shrink-0 text-center ${TONE[s.status]} ${s.status === "running" ? "animate-pulse" : ""}`}>{ICON[s.status]}</span>
            <span className={s.status === "pending" || s.status === "skipped" ? "text-neutral-400" : ""}>{s.label}</span>
            {s.detail && <span className="truncate text-neutral-500">· {s.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
