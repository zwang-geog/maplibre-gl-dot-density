import type { SourceConfig } from "../tiles/sources.ts";
import type { TileId } from "../tiles/ids.ts";
import type {
  TileEmptyResult,
  TileErrorResult,
  TileGeometryResult,
  WorkerInMessage,
} from "./protocol.ts";
import TileWorker from "./worker.ts?worker";

export type TileWorkerResult = TileGeometryResult | TileEmptyResult | TileErrorResult;

interface Pending {
  resolve: (value: TileWorkerResult) => void;
  workerIndex: number;
}

export class WorkerPool {
  /** Web Workers that fetch, decode MVT, and triangulate. */
  private readonly workers: Worker[] = [];
  /** In-flight `load` calls, keyed by `requestId`, so the result can resolve the right Promise. */
  private readonly pending = new Map<number, Pending>();
  /** Monotonic id assigned to each `load` (and matching abort / result). */
  private nextId = 1;
  /** Round-robin index into `workers` for the next `load`. */
  private cursor = 0;
  /** True after `init` has posted source config to every worker. */
  private inited = false;

  constructor(size = 2) {
    for (let i = 0; i < size; i++) {
      const worker = new TileWorker();
      // Main thread: handle the worker's result (or empty/error) for this requestId.
      worker.onmessage = (event: MessageEvent<TileWorkerResult>) => {
        const pending = this.pending.get(event.data.requestId);
        if (!pending) return;
        this.pending.delete(event.data.requestId);
        pending.resolve(event.data);
      };
      worker.onerror = (event) => {
        console.error("dot-density worker", event.message);
      };
      this.workers.push(worker);
    }
  }

  /**
   * Tell every worker which tileset to fetch and which data to read from it.
   * Sent once before any `load`. Later `load` messages only carry z/x/y.
   *
   * @param source - PMTiles URL or XYZ template(s) the worker uses in `fetch`.
   * @param sourceLayer - Name of the layer inside each MVT (`tippecanoe -l`).
   *   One `.pbf` / PMTiles tile can contain several layers (e.g. water, roads);
   *   this picks the polygon layer, such as `"counties"`.
   * @param fields - Property names to copy off each feature (density columns
   *   like `d_lths`). Unused for debug-colored fills; still decoded for later
   *   dot shaders.
   */
  init(source: SourceConfig, sourceLayer: string, fields: string[]): void {
    const message: WorkerInMessage = { type: "init", source, sourceLayer, fields };
    for (const worker of this.workers) worker.postMessage(message);
    this.inited = true;
  }

  load(tile: TileId): { requestId: number; promise: Promise<TileWorkerResult> } {
    if (!this.inited) throw new Error("WorkerPool.init must be called first");
    const requestId = this.nextId++;
    const workerIndex = this.cursor++ % this.workers.length;
    const promise = new Promise<TileWorkerResult>((resolve) => {
      this.pending.set(requestId, { resolve, workerIndex });
    });
    this.workers[workerIndex].postMessage({ type: "load", requestId, ...tile });
    return { requestId, promise };
  }

  abort(requestId: number): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.workers[pending.workerIndex].postMessage({ type: "abort", requestId });
    this.pending.delete(requestId);
  }

  destroy(): void {
    for (const id of [...this.pending.keys()]) this.abort(id);
    for (const worker of this.workers) worker.terminate();
    this.workers.length = 0;
  }
}
