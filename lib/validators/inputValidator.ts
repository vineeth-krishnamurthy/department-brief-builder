/** Google Place IDs are URL-safe base64-ish tokens; reject anything else before spending an API call. */
const PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;

export function validatePlaceId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  return PLACE_ID.test(id) ? id : null;
}
