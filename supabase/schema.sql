-- Brief storage. Run once in the Supabase SQL Editor.
-- RLS is on with no policies: only the server's secret key can read or write.
create extension if not exists pg_trgm;

create table departments (
  place_id       text primary key,
  name           text not null,
  address        text,
  city           text,
  state          text,
  fdid           text,
  website        text,
  latest_version int not null default 0,
  first_seen     timestamptz not null default now(),
  last_checked   timestamptz not null default now()
);
create index departments_name_trgm on departments using gin (name gin_trgm_ops);

create table brief_versions (
  id            bigint generated always as identity primary key,
  place_id      text not null references departments(place_id) on delete cascade,
  version       int not null,
  evidence_hash text not null,
  brief         jsonb not null,
  model         text,
  elapsed_ms    int,
  created_at    timestamptz not null default now(),
  unique (place_id, version)
);
create index brief_versions_latest on brief_versions (place_id, version desc);

alter table departments enable row level security;
alter table brief_versions enable row level security;
