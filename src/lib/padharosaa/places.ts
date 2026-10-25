// Pure helpers shared by the guest app and the manager screen (no network, no server-only imports).
export { haversineMeters, mapsDirectionsUrl } from './discover';

/** "450 m" or "2.3 km" */
export const discoverLabel = (m: number): string => (m < 950 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);

/** A place name from a map can arrive with a stray leading ":" or "-" or doubled spaces. Cleaned once here, for every way a place enters the guide. */
export const tidyPlaceName = (s: string): string => s.replace(/^[\s:;,.\-–—|]+/, '').replace(/\s+/g, ' ').trim();
