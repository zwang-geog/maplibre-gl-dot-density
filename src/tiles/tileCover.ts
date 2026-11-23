import type { TileId } from "./ids.ts";
import { pointToTile } from "./pointToTile.ts";

export interface LngLatBoundsLike {
  west: number;
  south: number;
  east: number;
  north: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Wrap to (-180, 180]. ` -190` → `170`. */
export function wrapLon(lon: number): number {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

function coverRange(
  west: number,
  south: number,
  east: number,
  north: number,
  z: number,
  margin: number,
): TileId[] {
  const n = 1 << z;
  const nw = pointToTile(west, north, z);
  const se = pointToTile(east, south, z);
  let minX = nw[0] - margin;
  let minY = nw[1] - margin;
  let maxX = se[0] + margin;
  let maxY = se[1] + margin;
  minX = clamp(minX, 0, n - 1);
  maxX = clamp(maxX, 0, n - 1);
  minY = clamp(minY, 0, n - 1);
  maxY = clamp(maxY, 0, n - 1);
  const tiles: TileId[] = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      tiles.push({ z, x, y });
    }
  }
  return tiles;
}

function coverAllX(
  south: number,
  north: number,
  z: number,
  margin: number,
): TileId[] {
  const n = 1 << z;
  const top = pointToTile(0, north, z);
  const bottom = pointToTile(0, south, z);
  const minY = clamp(top[1] - margin, 0, n - 1);
  const maxY = clamp(bottom[1] + margin, 0, n - 1);
  const tiles: TileId[] = [];
  for (let x = 0; x < n; x++) {
    for (let y = minY; y <= maxY; y++) {
      tiles.push({ z, x, y });
    }
  }
  return tiles;
}

function coverBounds(bounds: LngLatBoundsLike, z: number, margin: number): TileId[] {
  if (bounds.east - bounds.west >= 360) {
    return coverAllX(bounds.south, bounds.north, z, margin);
  }
  const west = wrapLon(bounds.west);
  const east = wrapLon(bounds.east);
  if (bounds.east >= bounds.west && west <= east) {
    return coverRange(west, bounds.south, east, bounds.north, z, margin);
  }
  return [
    ...coverRange(west, bounds.south, 180, bounds.north, z, margin),
    ...coverRange(-180, bounds.south, east, bounds.north, z, margin),
  ];
}

/**
 * Integer tiles covering a WGS84 bounding box at zoom `z`, plus `margin`
 * extra tiles. If `maxTiles` is set and the cover is larger, keep those
 * nearest the center. Prefer {@link tileZoomForView} so this cap is rarely hit.
 */
export function tilesForBounds(
  bounds: LngLatBoundsLike,
  z: number,
  options: { margin?: number; maxTiles?: number } = {},
): TileId[] {
  const zoom = Math.max(0, Math.floor(z));
  const margin = options.margin ?? 1;
  const tiles = coverBounds(bounds, zoom, margin);
  const maxTiles = options.maxTiles;
  if (maxTiles === undefined || tiles.length <= maxTiles) return tiles;

  const centerLon = wrapLon(bounds.west + (bounds.east - bounds.west) / 2);
  const centerLat = (bounds.south + bounds.north) / 2;
  const [cx, cy] = pointToTile(centerLon, centerLat, zoom);
  tiles.sort((a, b) => {
    const da = (a.x - cx) ** 2 + (a.y - cy) ** 2;
    const db = (b.x - cx) ** 2 + (b.y - cy) ** 2;
    return da - db;
  });
  return tiles.slice(0, maxTiles);
}

/**
 * Choose a tile zoom for the current view.
 *
 * - `viewZoom > maxzoom`: use `maxzoom` (overzoom those tiles).
 * - `viewZoom < minzoom`: return `null` (request nothing).
 * - otherwise start at `floor(viewZoom)`, then step down toward `minzoom`
 *   until the cover fits in `maxTiles`.
 */
export function tileZoomForView(
  bounds: LngLatBoundsLike,
  viewZoom: number,
  minzoom: number,
  maxzoom: number,
  options: { margin?: number; maxTiles?: number } = {},
): number | null {
  if (viewZoom < minzoom) return null;
  const margin = options.margin ?? 1;
  const maxTiles = options.maxTiles ?? 64;
  let z = Math.min(Math.floor(viewZoom), maxzoom);
  while (z > minzoom && coverBounds(bounds, z, margin).length > maxTiles) {
    z -= 1;
  }
  return z;
}
