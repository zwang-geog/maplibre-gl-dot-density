import type { SourceConfig } from "../tiles/sources.ts";
import type { TileId } from "../tiles/ids.ts";

export interface WorkerInitMessage {
  type: "init";
  source: SourceConfig;
  sourceLayer: string;
  fields: string[];
}

export interface WorkerLoadMessage extends TileId {
  type: "load";
  requestId: number;
}

export interface WorkerAbortMessage {
  type: "abort";
  requestId: number;
}

export type WorkerInMessage = WorkerInitMessage | WorkerLoadMessage | WorkerAbortMessage;

/**
 * Decoded, triangulated tile sent from the worker to the main thread.
 * `z`, `x`, `y` are the OSM tile id. Buffers are Transferable ArrayBuffers.
 *
 * Example: one square (4 verts, 2 triangles) and two density fields
 * (`d_lths`, `d_hs`), `extent` 4096:
 *
 * ```
 * positions     Int16  [0,0,  4096,0,  4096,4096,  0,4096]
 * indices       Uint32 [0,1,2,  0,2,3]
 * featureIndex  Uint32 [0,0,0,0]          // vertex → feature 0
 * densities     Float32 [12.5, 8.0]       // feature 0: two groups
 * vertexCount 4, indexCount 6, featureCount 1
 * ```
 */
export interface TileGeometryResult extends TileId {
  type: "result";
  /** Matches the `load` that produced this tile. */
  requestId: number;
  /**
   * MVT layer extent, usually 4096. Local x,y run about `0..extent`
   * (plus a small buffer past the edge).
   */
  extent: number;
  /** `positions.length / 2`. */
  vertexCount: number;
  /** `indices.length` (a multiple of 3). */
  indexCount: number;
  /** Polygons kept after skipping points/lines/empty meshes. */
  featureCount: number;
  /**
   * Packed tile-local vertices: `[x0, y0, x1, y1, …]`, `vertexCount` pairs.
   * Int16 is enough for typical extent 4096 plus buffer.
   */
  positions: Int16Array;
  /**
   * Triangle list into `positions` (vertex index, not byte offset):
   * `[i0, i1, i2, i0, i1, i2, …]`.
   */
  indices: Uint32Array;
  /**
   * Per-vertex feature id, length `vertexCount`. Values are `0 .. featureCount-1`,
   * matching rows in `densities`. One polygon’s vertices share one id.
   * Uint32 so a single tile can index more than 65,535 polygons (all US
   * block groups on one low-zoom tile is ~315k).
   */
  featureIndex: Uint32Array;
  /**
   * Row-major densities: length `featureCount * fields.length` (or `featureCount`
   * if `fields` is empty). Feature `f`, field `k` is at `f * fields.length + k`.
   * Units are people per km² for the named properties from `init`.
   */
  densities: Float32Array;
}

export interface TileEmptyResult extends TileId {
  type: "empty";
  requestId: number;
}

export interface TileErrorResult extends TileId {
  type: "error";
  requestId: number;
  message: string;
}

export type WorkerOutMessage = TileGeometryResult | TileEmptyResult | TileErrorResult;
