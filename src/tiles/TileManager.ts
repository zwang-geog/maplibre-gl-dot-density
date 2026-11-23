import { Lru } from "./lru.ts";
import {
  childTiles,
  clipInAncestor,
  parentTile,
  tileKey,
  type TileId,
} from "./ids.ts";
import { tileZoomForView, tilesForBounds, type LngLatBoundsLike } from "./tileCover.ts";
import type { SourceConfig } from "./sources.ts";
import { WorkerPool } from "../worker/WorkerPool.ts";
import { TileResources } from "../gl/TileResources.ts";
import type { TileGeometryResult } from "../worker/protocol.ts";

export interface DrawItem {
  tile: TileId;
  resources: TileResources;
  /** minX, minY, maxX, maxY in the drawn tile's local coordinates. */
  clipRect: [number, number, number, number];
  placeholder: boolean;
}

export interface TileManagerOptions {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  source: SourceConfig;
  sourceLayer: string;
  fields: string[];
  minzoom: number;
  maxzoom: number;
  maxTiles?: number;
  cacheSize?: number;
  onUpdate: () => void;
}

interface Loading {
  requestId: number;
  tile: TileId;
}

export class TileManager {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly pool: WorkerPool;
  private readonly ready: Lru<TileResources>;
  private readonly loading = new Map<string, Loading>();
  private readonly empty = new Set<string>();
  private readonly onUpdate: () => void;
  readonly minzoom: number;
  readonly maxzoom: number;
  private readonly maxTiles: number;
  private destroyed = false;

  stats = { ready: 0, loading: 0, empty: 0, drawn: 0, aborted: 0 };

  constructor(options: TileManagerOptions) {
    this.gl = options.gl;
    this.program = options.program;
    this.onUpdate = options.onUpdate;
    this.minzoom = options.minzoom;
    this.maxzoom = options.maxzoom;
    this.maxTiles = options.maxTiles ?? 64;
    this.ready = new Lru(options.cacheSize ?? 256);
    this.pool = new WorkerPool(2);
    this.pool.init(options.source, options.sourceLayer, options.fields);
  }

  /**
   * Sync tile requests with the current map view and return what to draw.
   *
   * Chooses a tile zoom for `bounds` (overzoom / underzoom / budget),
   * requests missing tiles on the worker pool, cancels requests that have
   * left the view, and fills holes with cached parent or child tiles until
   * the ideal tiles arrive. Call from the custom layer's `render` hook;
   * decoded tiles invoke `onUpdate` so the map can repaint.
   *
   * @param bounds - Visible WGS84 rectangle (may cross the antimeridian).
   * @param zoom - Map zoom (need not be an integer).
   * @returns Draw list in the order the caller should issue `drawElements`.
   */
  setView(bounds: LngLatBoundsLike, zoom: number): DrawItem[] {
    // Tile zoom: null below minzoom; otherwise floor(zoom) clamped to maxzoom
    // and stepped down until the cover fits maxTiles.
    const tz = tileZoomForView(bounds, zoom, this.minzoom, this.maxzoom, {
      margin: 1,
      maxTiles: this.maxTiles,
    });
    if (tz === null) {
      this.abortExcept(new Set());
      this.stats.drawn = 0;
      return [];
    }

    // Ideal tiles for this view. Keys are "z/x/y" strings, matching loading/ready.
    const needed = tilesForBounds(bounds, tz, { margin: 1, maxTiles: this.maxTiles });
    const neededKeys = new Set(needed.map(tileKey));

    // Identify in-flight parents of needed tiles; they may still be used as
    // placeholders while the children load.
    const ancestorKeys = new Set<string>();
    for (const tile of needed) {
      let parent = parentTile(tile);
      while (parent && parent.z >= this.minzoom) {
        ancestorKeys.add(tileKey(parent));
        parent = parentTile(parent);
      }
    }

    // Cancel fetches that have left the view. Do not cancel tiles still in
    // `neededKeys` or parents in `ancestorKeys`.
    this.abortExcept(neededKeys, ancestorKeys);

    const draws: DrawItem[] = [];
    const inUse = new Set<string>();

    for (const tile of needed) {
      const key = tileKey(tile);
      // If this tile is already in the LRU cache, draw it in full and mark it
      // in-use so eviction will not delete it this frame.
      const resources = this.ready.get(key);
      if (resources) {
        inUse.add(key);
        draws.push({
          tile,
          resources,
          clipRect: [0, 0, resources.extent, resources.extent],
          placeholder: false,
        });
        continue;
      }

      // Cache miss: fetch unless we already know the server has no tile here.
      if (!this.empty.has(key)) this.request(tile);

      // Zooming out: show any cached children that already cover this area.
      const children = this.readyChildren(tile);
      if (children.length > 0) {
        for (const child of children) {
          inUse.add(tileKey(child.tile));
          draws.push(child);
        }
        continue;
      }
      // Zooming in: stretch the nearest cached ancestor, clipped to this tile.
      const ancestor = this.readyAncestor(tile);
      if (ancestor) {
        inUse.add(tileKey(ancestor.tile));
        draws.push(ancestor);
      }
    }

    this.evict(inUse);
    this.stats.ready = this.ready.size;
    this.stats.loading = this.loading.size;
    this.stats.empty = this.empty.size;
    this.stats.drawn = draws.length;
    return draws;
  }

  destroy(): void {
    this.destroyed = true;
    this.pool.destroy();
    for (const resources of this.ready.values()) resources.destroy();
  }

  private abortExcept(neededKeys: Set<string>, ancestorKeys: Set<string> = new Set()): void {
    for (const [key, loading] of this.loading) {
      if (!neededKeys.has(key) && !ancestorKeys.has(key)) {
        this.pool.abort(loading.requestId);
        this.loading.delete(key);
        this.stats.aborted += 1;
      }
    }
  }

  private request(tile: TileId): void {
    const key = tileKey(tile);
    if (this.loading.has(key) || this.empty.has(key) || this.ready.has(key)) return;
    const { requestId, promise } = this.pool.load(tile);
    this.loading.set(key, { requestId, tile });
    // Resolves in WorkerPool when that worker's `onmessage` runs (main thread).
    void promise.then((result) => {
      if (this.destroyed) return;
      this.loading.delete(key);
      if (result.type === "empty") {
        this.empty.add(key);
        this.onUpdate();
        return;
      }
      if (result.type === "error") {
        console.warn(`tile ${key}: ${result.message}`);
        return;
      }
      this.store(result);
      this.onUpdate();
    });
  }

  private store(result: TileGeometryResult): void {
    const key = tileKey(result);
    const existing = this.ready.peek(key);
    existing?.destroy();
    this.ready.set(key, new TileResources(this.gl, result, this.program));
  }

  private readyChildren(tile: TileId): DrawItem[] {
    if (tile.z >= this.maxzoom) return [];
    const items: DrawItem[] = [];
    for (const child of childTiles(tile)) {
      const resources = this.ready.peek(tileKey(child));
      if (!resources) continue;
      items.push({
        tile: child,
        resources,
        clipRect: [0, 0, resources.extent, resources.extent],
        placeholder: true,
      });
    }
    return items;
  }

  private readyAncestor(tile: TileId): DrawItem | null {
    let parent = parentTile(tile);
    while (parent && parent.z >= this.minzoom) {
      const resources = this.ready.peek(tileKey(parent));
      if (resources) {
        return {
          tile: parent,
          resources,
          clipRect: clipInAncestor(tile, parent, resources.extent),
          placeholder: true,
        };
      }
      parent = parentTile(parent);
    }
    return null;
  }

  private evict(inUse: Set<string>): void {
    for (const key of this.ready.keys()) {
      if (this.ready.size <= this.ready.maxSize) break;
      if (inUse.has(key)) continue;
      this.ready.peek(key)?.destroy();
      this.ready.delete(key);
    }
  }
}
