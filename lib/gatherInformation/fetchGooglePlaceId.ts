import type { Place } from "../utils/dataTypes";

type Component = { longText: string; shortText: string; types: string[] };

export class PlaceNotFound extends Error {
  status = 404;
  constructor(id: string) {
    super(`Google has no place with ID "${id}". Check the ID and try again.`);
  }
}

/** Google Places API (New): one GET returns everything we need. */
export async function getPlace(placeId: string): Promise<Place> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error("GOOGLE_PLACES_API_KEY is not set");

  const res = await fetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
    {
      headers: {
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask":
          "id,displayName,formattedAddress,addressComponents,location,nationalPhoneNumber,websiteUri,types",
      },
      signal: AbortSignal.timeout(8000),
    },
  );
  if (res.status === 400 || res.status === 404) throw new PlaceNotFound(placeId);
  if (!res.ok) throw new Error(`Places API ${res.status}: ${await res.text()}`);
  const p = await res.json();

  const comp = (t: string, short = false) => {
    const c = (p.addressComponents as Component[] | undefined)?.find((c) =>
      c.types.includes(t),
    );
    return (short ? c?.shortText : c?.longText) ?? "";
  };

  return {
    id: p.id,
    name: p.displayName?.text ?? "",
    address: p.formattedAddress ?? "",
    city: comp("locality") || comp("sublocality") || comp("administrative_area_level_3"),
    state: comp("administrative_area_level_1", true),
    zip: comp("postal_code"),
    phone: p.nationalPhoneNumber ?? "",
    website: p.websiteUri ?? "",
    lat: p.location?.latitude ?? 0,
    lng: p.location?.longitude ?? 0,
    types: p.types ?? [],
  };
}
