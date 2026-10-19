/**
 * Live progress for one brief request. Each step has a weight; the overall percentage is the
 * weighted share of finished steps plus the partial progress of running ones. Every change is
 * sent to the browser as one event, so the progress bar moves as work actually completes.
 */
export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";
export type Step = { id: StepId; label: string; status: StepStatus; detail?: string };
export type ProgressEvent = { type: "progress"; pct: number; steps: Step[] };

const STEPS = [
  { id: "place", label: "Look up the Google Place", weight: 4 },
  { id: "gate", label: "Check it is a government fire department", weight: 2 },
  { id: "grants", label: "Federal grants (FEMA, USAspending)", weight: 5 },
  { id: "nonprofit", label: "IRS 990 filings", weight: 3 },
  { id: "search", label: "Web search for the department", weight: 6 },
  { id: "site", label: "Crawl the department website and search results", weight: 14 },
  { id: "meetings", label: "Council and board records", weight: 7 },
  { id: "compare", label: "Compare with stored briefs", weight: 3 },
  { id: "claude", label: "Write the brief with Claude", weight: 50 },
  { id: "save", label: "Save the new version", weight: 5 },
] as const;

export type StepId = (typeof STEPS)[number]["id"];

export class Progress {
  private state = new Map<StepId, { status: StepStatus; detail?: string; fraction: number }>(
    STEPS.map((s) => [s.id, { status: "pending", fraction: 0 }]),
  );

  constructor(private send: (e: ProgressEvent) => void) {}

  start(id: StepId, detail?: string) { this.set(id, { status: "running", detail, fraction: 0 }); }
  partial(id: StepId, fraction: number, detail?: string) {
    const cur = this.state.get(id)!;
    this.set(id, { status: "running", detail: detail ?? cur.detail, fraction: Math.max(cur.fraction, Math.min(0.97, fraction)) });
  }
  done(id: StepId, detail?: string) { this.set(id, { status: "done", detail, fraction: 1 }); }
  fail(id: StepId, detail?: string) { this.set(id, { status: "failed", detail, fraction: 1 }); }
  skip(id: StepId, detail?: string) { this.set(id, { status: "skipped", detail, fraction: 1 }); }
  skipRemaining(detail: string) {
    for (const [id, s] of this.state) if (s.status === "pending" || s.status === "running") this.state.set(id, { status: "skipped", detail, fraction: 1 });
    this.emit();
  }

  /** Run a step around a promise: running while it works, done or failed after, with a summary. */
  async track<T>(id: StepId, work: Promise<T>, summarize: (v: T) => { status?: "done" | "failed"; detail: string }): Promise<T> {
    this.start(id);
    const v = await work;
    const { status = "done", detail } = summarize(v);
    if (status === "failed") this.fail(id, detail);
    else this.done(id, detail);
    return v;
  }

  private set(id: StepId, s: { status: StepStatus; detail?: string; fraction: number }) {
    this.state.set(id, s);
    this.emit();
  }

  private emit() {
    const total = STEPS.reduce((n, s) => n + s.weight, 0);
    const got = STEPS.reduce((n, s) => n + s.weight * this.state.get(s.id)!.fraction, 0);
    this.send({
      type: "progress",
      pct: Math.round((got / total) * 100),
      steps: STEPS.map((s) => ({ id: s.id, label: s.label, status: this.state.get(s.id)!.status, detail: this.state.get(s.id)!.detail })),
    });
  }
}
