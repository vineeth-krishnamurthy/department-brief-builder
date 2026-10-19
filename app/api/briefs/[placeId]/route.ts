import { NextResponse } from "next/server";
import { listVersions, storeConfigured } from "@/lib/utils/briefStore";
import { validatePlaceId } from "@/lib/validators/inputValidator";

/** GET /api/briefs/<Place ID>: the department and every stored version, newest first (without brief bodies). */
export async function GET(_req: Request, { params }: { params: Promise<{ placeId: string }> }) {
  if (!storeConfigured()) return NextResponse.json({ error: "Brief storage is not configured." }, { status: 503 });
  const placeId = validatePlaceId((await params).placeId);
  if (!placeId) return NextResponse.json({ error: "Invalid Place ID." }, { status: 400 });
  try {
    const found = await listVersions(placeId);
    if (!found) return NextResponse.json({ error: "No stored briefs for this Place ID." }, { status: 404 });
    return NextResponse.json(found);
  } catch (e) {
    console.error("list versions failed:", (e as Error).message);
    return NextResponse.json({ error: "Could not load stored briefs." }, { status: 500 });
  }
}
