import type { Brief } from "@/lib/utils/dataTypes";

/** One brief: header, why-call line, then sections of cited facts. Used on the home page and the stored-briefs pages. */
export function BriefView({ brief }: { brief: Brief }) {
  const { place, registry } = brief;
  return (
    <article className="mt-6">
      <div className="border-b border-neutral-200 pb-4 dark:border-neutral-800">
        <h2 className="text-xl font-semibold">{place.name}</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{place.address}</p>
        <p className="mt-1 text-sm">
          {place.phone && <span className="mr-4">{place.phone}</span>}
          {place.website && (
            <a href={place.website} target="_blank" rel="noreferrer" className="underline">
              {hostOf(place.website)}
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
          {s.facts.length === 0 && s.not_found && (
            <p className="rounded-md border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500 dark:border-neutral-700">
              {s.not_found} Worth asking on the call.
            </p>
          )}
          <ul className="space-y-2 text-sm">
            {s.facts.map((f, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-neutral-400">•</span>
                <div className="min-w-0">
                  <p>{f.text}</p>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    <a
                      href={f.link ?? f.source_url}
                      target="_blank"
                      rel="noreferrer"
                      title={f.source_url}
                      className="text-blue-700 underline dark:text-blue-400"
                    >
                      {[f.source_type, f.source_title || hostOf(f.source_url)].filter(Boolean).join(" · ")}
                    </a>
                    {f.date && <span> · {f.date_label ? `${f.date_label} ` : ""}{formatDate(f.date)}</span>}
                  </p>
                  {f.quote && (
                    <blockquote className="mt-1 border-l-2 border-neutral-300 pl-2 text-xs italic text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
                      &ldquo;{f.quote}&rdquo;
                    </blockquote>
                  )}
                </div>
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

/** "2025-09-27" reads as "Sep 27, 2025"; years and ranges are shown as given. */
export function formatDate(d: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
