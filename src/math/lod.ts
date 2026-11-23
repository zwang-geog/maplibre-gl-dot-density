/** Equatorial Earth circumference (km). */
export const EARTH_EQUATOR_KM = 40075.016686;
/** MapLibre mercator world size at zoom 0, in CSS pixels. */
export const WORLD_TILE_PX = 512;

/** People represented by one dot at integer level `L`. */
export function peoplePerDot(
  viewZoom: number,
  dotValue: number,
  referenceZoom: number,
  alpha: number,
  minDotValue = 1,
): number {
  const L = Math.floor(viewZoom);
  const k = dotValue * 2 ** (-alpha * (L - referenceZoom));
  return Math.max(minDotValue, k);
}

/**
 * How many 1px world-anchored cells fit along one edge of a vector tile at `tz`,
 * when the cell grid is defined at integer level `L`.
 */
export function cellsPerVectorTile(L: number, tz: number): number {
  return WORLD_TILE_PX * 2 ** (L - tz);
}

/** Ground area of one 1px cell at the equator, in km². */
export function cellAreaEquatorKm2(L: number): number {
  const km = EARTH_EQUATOR_KM / (WORLD_TILE_PX * 2 ** L);
  return km * km;
}

export function splitOrigin(tileX: number, tileY: number, cellsPerTile: number): {
  originInt: [number, number];
  originFrac: [number, number];
} {
  const ox = tileX * cellsPerTile;
  const oy = tileY * cellsPerTile;
  const ix = Math.floor(ox);
  const iy = Math.floor(oy);
  return { originInt: [ix, iy], originFrac: [ox - ix, oy - iy] };
}
