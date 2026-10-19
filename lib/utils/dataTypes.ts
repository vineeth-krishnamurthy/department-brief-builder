import type { ProgressEvent } from "./progress";

export type Place = {
  id: string;
  name: string;
  address: string;
  city: string;
  county?: string; // "Gwinnett County"; older stored briefs lack it
  state: string;
  zip: string;
  phone: string;
  website: string;
  lat: number;
  lng: number;
  types: string[];
};

export type RegistryEntry = {
  fdid: string;
  name: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  dept_type: string;
  org_type: string;
  website: string;
  stations: string;
  career: string;
  volunteer: string;
  paid_per_call: string;
};

export type Fact = {
  text: string;
  source_url: string;
  source_title: string;
  source_type?: string; // e.g. "Federal grant record", "Department website", "News"
  quote?: string; // verbatim evidence, verified against the fetched text
  date?: string; // only when the source itself states it
  date_label?: string; // what the date means: "Published", "Award start", "Tax year", "Meeting", ...
  link?: string; // source_url with a text fragment that highlights the quote, when possible
};

export type Section = {
  title: string;
  facts: Fact[];
  not_found?: string; // set on a required section that came back empty: what was checked
};

export type Brief = {
  place: Place;
  registry: RegistryEntry | null;
  registry_date: string;
  sections: Section[];
  why_call_today: string;
  elapsed_ms: number;
  generated_at: string;
  storage?: BriefStorage; // set on the way out; not part of the stored brief
};

export type BriefStorage =
  | { status: "new"; version: number; saved_at: string }
  | { status: "unchanged"; version: number; saved_at: string }
  | { status: "not_saved"; reason: string };

export type Rejection = {
  rejected: true;
  reason: string;
  place?: Place;
};

/** Events streamed by the brief route (newline-delimited JSON). */
export type BriefEvent =
  | ProgressEvent
  | { type: "result"; brief: Brief }
  | { type: "unchanged"; message: string; brief: Brief }
  | { type: "rejected"; reason: string; place: Place }
  | { type: "error"; message: string };
