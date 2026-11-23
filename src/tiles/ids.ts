export interface TileId {
  z: number;
  x: number;
  y: number;
}

export function tileKey(tile: TileId): string {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

export function parseTileKey(key: string): TileId {
  const [z, x, y] = key.split("/").map(Number);
  return { z, x, y };
}

export function parentTile(tile: TileId): TileId | null {
  if (tile.z <= 0) return null;
  return { z: tile.z - 1, x: tile.x >> 1, y: tile.y >> 1 };
}

export function childTiles(tile: TileId): TileId[] {
  const z = tile.z + 1;
  const x = tile.x << 1;
  const y = tile.y << 1;
  return [
    { z, x, y },
    { z, x: x + 1, y },
    { z, x, y: y + 1 },
    { z, x: x + 1, y: y + 1 },
  ];
}

/** Child's rectangle in the ancestor's local tile coordinates. */
export function clipInAncestor(
  child: TileId,
  ancestor: TileId,
  extent: number,
): [number, number, number, number] {
  const dz = child.z - ancestor.z;
  if (dz < 0) {
    throw new RangeError("child zoom must be >= ancestor zoom");
  }
  const scale = extent / (1 << dz);
  const x0 = (child.x - (ancestor.x << dz)) * scale;
  const y0 = (child.y - (ancestor.y << dz)) * scale;
  return [x0, y0, x0 + scale, y0 + scale];
}
