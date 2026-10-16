export type Place = {
  id: string;
  name: string;
  address: string;
  city: string;
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
};

export type Section = {
  title: string;
  facts: Fact[];
};

export type Brief = {
  place: Place;
  registry: RegistryEntry | null;
  registry_date: string;
  sections: Section[];
  why_call_today: string;
  elapsed_ms: number;
  generated_at: string;
  cached?: boolean; // true when served from the brief cache rather than researched now
};

export type Rejection = {
  rejected: true;
  reason: string;
  place?: Place;
};
