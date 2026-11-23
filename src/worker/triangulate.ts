import { classifyRings } from "@mapbox/vector-tile";
import earcut from "earcut";

export { classifyRings };

export interface Point {
  x: number;
  y: number;
}

/**
 * Turn classified polygons into a triangle mesh in tile-local coordinates.
 *
 * `polygons` is the output of `classifyRings`: an array of polygons, each
 * `rings` list starting with the outer ring and followed by holes.
 *
 * @returns `positions` as packed x,y pairs; `indices` as triples of vertex
 *   offsets into that array (one triangle each).
 */
export function triangulatePolygons(polygons: Point[][][]): {
  positions: Int16Array;
  indices: Uint32Array;
} {
  const positions: number[] = [];
  const indices: number[] = [];

  for (const rings of polygons) {
    if (rings.length === 0) continue;
    const flat: number[] = [];
    const holes: number[] = [];
    for (let r = 0; r < rings.length; r++) {
      // earcut wants hole start indices in the flattened vertex list.
      if (r > 0) holes.push(flat.length / 2);
      for (const p of rings[r]) {
        flat.push(p.x, p.y);
      }
    }
    const tris = earcut(flat, holes);
    // Indices from earcut are 0-based in `flat`; shift into the combined mesh.
    const base = positions.length / 2;
    positions.push(...flat);
    for (const index of tris) indices.push(base + index);
  }

  return {
    positions: Int16Array.from(positions),
    indices: Uint32Array.from(indices),
  };
}
