import { PostgrestClient } from "@supabase/postgrest-js";
import type { Brief, Place, RegistryEntry } from "./dataTypes";

/**
 * Every brief for a valid fire department, stored by version in Supabase Postgres.
 * Server-only: uses the secret key, which bypasses row-level security. The tables have RLS
 * on with no policies, so nothing is readable with a public key.
 *
 * Talks to Supabase's REST API through its PostgREST client only. The full supabase-js client
 * also starts a realtime websocket, which this app doesn't use and which fails on Node 20.
 *
 *   departments     one row per Google Place ID
 *   brief_versions  one row per distinct set of gathered evidence (see evidenceHash)
 */
export type StoredVersion = { version: number; evidence_hash: string; brief: Brief; created_at: string };
export type DepartmentRow = {
  place_id: string; name: string; address: string | null; city: string | null; state: string | null;
  fdid: string | null; website: string | null; latest_version: number; first_seen: string; last_checked: string;
};
export type VersionRow = { version: number; evidence_hash: string; created_at: string; model: string | null; elapsed_ms: number | null };

let client: PostgrestClient | null | undefined;

function db(): PostgrestClient | null {
  if (client !== undefined) return client;
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
  client = url && key ? new PostgrestClient(`${url.replace(/\/$/, "")}/rest/v1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } }) : null;
  return client;
}

export const storeConfigured = () => db() !== null;

export async function latestVersion(placeId: string): Promise<StoredVersion | null> {
  const c = db();
  if (!c) return null;
  const { data, error } = await c
    .from("brief_versions")
    .select("version, evidence_hash, brief, created_at")
    .eq("place_id", placeId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Supabase: ${error.message}`);
  return data as StoredVersion | null;
}

/** Record that the department was checked again without new information. */
export async function touchDepartment(placeId: string): Promise<void> {
  const c = db();
  if (!c) return;
  await c.from("departments").update({ last_checked: new Date().toISOString() }).eq("place_id", placeId);
}

/**
 * Save a brief as the next version. If another request saved a version for the same
 * department at the same moment, the unique (place_id, version) rule rejects one of them;
 * that request returns the version that won instead of failing.
 */
export async function saveVersion(args: {
  place: Place; registry: RegistryEntry | null; hash: string; brief: Brief; previous: StoredVersion | null; model: string;
}): Promise<{ version: number; created_at: string }> {
  const c = db();
  if (!c) throw new Error("Supabase is not configured");
  const { place, registry, hash, brief, previous, model } = args;
  const now = new Date().toISOString();

  const dept = await c.from("departments").upsert(
    { place_id: place.id, name: place.name, address: place.address, city: place.city, state: place.state, fdid: registry?.fdid ?? null, website: place.website || null, last_checked: now },
    { onConflict: "place_id" },
  );
  if (dept.error) throw new Error(`Supabase: ${dept.error.message}`);

  const version = (previous?.version ?? 0) + 1;
  const ins = await c
    .from("brief_versions")
    .insert({ place_id: place.id, version, evidence_hash: hash, brief, model, elapsed_ms: brief.elapsed_ms })
    .select("version, created_at")
    .single();

  if (ins.error) {
    if (ins.error.code === "23505") {
      const winner = await latestVersion(place.id);
      if (winner) return { version: winner.version, created_at: winner.created_at };
    }
    throw new Error(`Supabase: ${ins.error.message}`);
  }
  await c.from("departments").update({ latest_version: version }).eq("place_id", place.id);
  return ins.data as { version: number; created_at: string };
}

const PLACE_ID = /^[A-Za-z0-9_-]{20,300}$/;

/** Departments matching a name (every word must appear) or an exact Place ID; newest first when empty. */
export async function searchDepartments(q: string): Promise<DepartmentRow[]> {
  const c = db();
  if (!c) throw new Error("Supabase is not configured");
  const term = q.trim();
  let query = c.from("departments").select("*").gt("latest_version", 0);
  if (PLACE_ID.test(term) && !/\s/.test(term)) {
    query = query.eq("place_id", term);
  } else {
    for (const w of term.toLowerCase().replace(/[^a-z0-9' -]/g, " ").split(/\s+/).filter(Boolean).slice(0, 6)) {
      query = query.ilike("name", `%${w}%`);
    }
  }
  const { data, error } = await query.order("last_checked", { ascending: false }).limit(100);
  if (error) throw new Error(`Supabase: ${error.message}`);
  return (data ?? []) as DepartmentRow[];
}

export async function listVersions(placeId: string): Promise<{ department: DepartmentRow; versions: VersionRow[] } | null> {
  const c = db();
  if (!c) throw new Error("Supabase is not configured");
  const [dept, versions] = await Promise.all([
    c.from("departments").select("*").eq("place_id", placeId).maybeSingle(),
    c.from("brief_versions").select("version, evidence_hash, created_at, model, elapsed_ms").eq("place_id", placeId).order("version", { ascending: false }),
  ]);
  if (dept.error) throw new Error(`Supabase: ${dept.error.message}`);
  if (versions.error) throw new Error(`Supabase: ${versions.error.message}`);
  if (!dept.data) return null;
  return { department: dept.data as DepartmentRow, versions: (versions.data ?? []) as VersionRow[] };
}

export async function getVersion(placeId: string, version: number): Promise<StoredVersion | null> {
  const c = db();
  if (!c) throw new Error("Supabase is not configured");
  const { data, error } = await c
    .from("brief_versions")
    .select("version, evidence_hash, brief, created_at")
    .eq("place_id", placeId)
    .eq("version", version)
    .maybeSingle();
  if (error) throw new Error(`Supabase: ${error.message}`);
  return data as StoredVersion | null;
}
