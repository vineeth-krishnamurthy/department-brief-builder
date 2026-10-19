import { NextResponse } from "next/server";
import { getVersion, storeConfigured } from "@/lib/storage/briefStore";
import { validatePlaceId } from "@/lib/validators/inputValidator";

/** GET /api/stored-briefs/<Place ID>/versions/<version>: one stored brief. */
export async function GET(_req: Request, { params }: { params: Promise<{ placeId: string; version: string }> }) {
  if (!storeConfigured()) return NextResponse.json({ error: "Brief storage is not configured." }, { status: 503 });
  const p = await params;
  const placeId = validatePlaceId(p.placeId);
  const version = Number(p.version);
  if (!placeId || !Number.isInteger(version) || version < 1) return NextResponse.json({ error: "Invalid Place ID or version." }, { status: 400 });
  try {
    const found = await getVersion(placeId, version);
    if (!found) return NextResponse.json({ error: "That version doesn't exist." }, { status: 404 });
    return NextResponse.json(found);
  } catch (e) {
    console.error("get version failed:", (e as Error).message);
    return NextResponse.json({ error: "Could not load the brief." }, { status: 500 });
  }
}
