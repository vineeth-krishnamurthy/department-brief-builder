import { NextResponse } from "next/server";
import { searchDepartments, storeConfigured } from "@/lib/storeBrief/briefStore";

/** GET /api/stored-briefs?q=wise%20avenue  or  ?q=<Place ID>. Departments with at least one stored brief. */
export async function GET(req: Request) {
  if (!storeConfigured()) return NextResponse.json({ error: "Brief storage is not configured." }, { status: 503 });
  const q = new URL(req.url).searchParams.get("q")?.slice(0, 200) ?? "";
  try {
    return NextResponse.json({ departments: await searchDepartments(q) });
  } catch (e) {
    console.error("search failed:", (e as Error).message);
    return NextResponse.json({ error: "Could not load stored briefs." }, { status: 500 });
  }
}
