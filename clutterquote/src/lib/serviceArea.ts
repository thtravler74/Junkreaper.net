import type { Cents, ServiceAreaConfig } from "./types";

export interface LatLng {
  lat: number;
  lng: number;
}

export type Geocoder = (zip: string) => Promise<LatLng | null>;

export type ServiceAreaResult =
  | { status: "in_area"; distanceMiles: number | null; tripFeeCents: 0 }
  | { status: "extended"; distanceMiles: number; tripFeeCents: Cents }
  | { status: "out_of_area"; distanceMiles: number | null; tripFeeCents: 0 }
  /** Geocoding failed: let the customer continue and have the office confirm. */
  | { status: "unverified"; distanceMiles: null; tripFeeCents: 0 };

export const ZIP_PATTERN = /^\d{5}$/;

/** Great-circle distance in statute miles. */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Explicit zip lists win over distance. Distance is straight-line from the
 * hauler's base to the zip centroid: a cheap proxy for drive time, which is why
 * the extended band exists (charge a trip fee rather than refuse a borderline job).
 */
export async function checkServiceArea(zip: string, cfg: ServiceAreaConfig, geocode: Geocoder): Promise<ServiceAreaResult> {
  if (cfg.excludeZips.includes(zip)) return { status: "out_of_area", distanceMiles: null, tripFeeCents: 0 };
  if (cfg.includeZips.includes(zip) || zip === cfg.baseZip) return { status: "in_area", distanceMiles: null, tripFeeCents: 0 };

  let point: LatLng | null;
  try {
    point = await geocode(zip);
  } catch {
    point = null;
  }
  if (!point) return { status: "unverified", distanceMiles: null, tripFeeCents: 0 };

  const distance = Math.round(haversineMiles({ lat: cfg.baseLat, lng: cfg.baseLng }, point) * 10) / 10;
  if (distance <= cfg.radiusMiles) return { status: "in_area", distanceMiles: distance, tripFeeCents: 0 };
  if (distance <= cfg.radiusMiles + cfg.extendedMiles) {
    return { status: "extended", distanceMiles: distance, tripFeeCents: cfg.extendedTripFeeCents };
  }
  return { status: "out_of_area", distanceMiles: distance, tripFeeCents: 0 };
}

const cache = new Map<string, LatLng | null>();

/**
 * US zip centroid lookup via the free Zippopotam.us API (no key). Results,
 * including misses, are memoized per process. Swap in a bundled dataset or a
 * paid geocoder for production volume.
 */
export const zippopotamGeocoder: Geocoder = async (zip) => {
  if (cache.has(zip)) return cache.get(zip) ?? null;
  const response = await fetch(`https://api.zippopotam.us/us/${zip}`, { signal: AbortSignal.timeout(4000) });
  if (response.status === 404) {
    cache.set(zip, null);
    return null;
  }
  if (!response.ok) throw new Error(`geocoder ${response.status}`);
  const data = (await response.json()) as { places?: { latitude: string; longitude: string }[] };
  const place = data.places?.[0];
  const point = place ? { lat: Number(place.latitude), lng: Number(place.longitude) } : null;
  cache.set(zip, point);
  return point;
};
