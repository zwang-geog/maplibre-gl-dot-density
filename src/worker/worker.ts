import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { getTileBytes, type SourceConfig } from "../tiles/sources.ts";
import { classifyRings, triangulatePolygons } from "./triangulate.ts";
import type { WorkerInMessage, WorkerOutMessage } from "./protocol.ts";

let source: SourceConfig | null = null;
let sourceLayer = "";
let fields: string[] = [];
const inflight = new Map<number, AbortController>();

function post(message: WorkerOutMessage, transfer: Transferable[] = []): void {
  (self as DedicatedWorkerGlobalScope).postMessage(message, transfer);
}

self.onmessage = async (event: MessageEvent<WorkerInMessage>) => {
  const data = event.data;
  if (data.type === "init") {
    source = data.source;
    sourceLayer = data.sourceLayer;
    fields = data.fields;
    return;
  }
  if (data.type === "abort") {
    inflight.get(data.requestId)?.abort();
    inflight.delete(data.requestId);
    return;
  }
  if (data.type !== "load" || !source) return;

  const controller = new AbortController();
  inflight.set(data.requestId, controller);
  const { requestId, z, x, y } = data;
  try {
    const bytes = await getTileBytes(source, z, x, y, controller.signal);
    if (controller.signal.aborted) return;
    if (!bytes) {
      post({ type: "empty", requestId, z, x, y });
      return;
    }
    const tile = new VectorTile(new Pbf(bytes));
    const layer = tile.layers[sourceLayer];
    if (!layer || layer.length === 0) {
      post({ type: "empty", requestId, z, x, y });
      return;
    }

    const posChunks: Int16Array[] = [];
    const indexChunks: Uint32Array[] = [];
    const featureChunks: number[] = [];
    const densities = new Float32Array(layer.length * Math.max(fields.length, 1));
    let vertexBase = 0;
    let featureCount = 0;

    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i);
      if (feature.type !== 3) continue;
      // Flat list of rings in tile coordinates (outers and holes mixed).
      const rings = feature.loadGeometry();
      // Split into polygons: each item is [outer, ...holes], using opposite winding.
      const polygons = classifyRings(rings);
      const { positions, indices } = triangulatePolygons(polygons);
      if (indices.length === 0) continue;

      posChunks.push(positions);
      const shifted = new Uint32Array(indices.length);
      for (let k = 0; k < indices.length; k++) shifted[k] = indices[k] + vertexBase;
      indexChunks.push(shifted);
      const verts = positions.length / 2;
      for (let v = 0; v < verts; v++) featureChunks.push(featureCount);
      vertexBase += verts;

      for (let f = 0; f < fields.length; f++) {
        const raw = feature.properties[fields[f]];
        const value = typeof raw === "number" ? raw : Number(raw);
        densities[featureCount * fields.length + f] = Number.isFinite(value) ? value : 0;
      }
      featureCount += 1;
    }

    if (featureCount === 0) {
      post({ type: "empty", requestId, z, x, y });
      return;
    }

    const positions = concatInt16(posChunks);
    const indices = concatUint32(indexChunks);
    const featureIndex = Uint32Array.from(featureChunks);
    const densityOut = densities.subarray(0, featureCount * Math.max(fields.length, 1));
    const densityCopy = new Float32Array(densityOut);

    // Geometry + densities for this z/x/y; field layout is TileGeometryResult.
    post(
      {
        type: "result",
        requestId,
        z,
        x,
        y,
        extent: layer.extent,
        vertexCount: positions.length / 2,
        indexCount: indices.length,
        featureCount,
        positions,
        indices,
        featureIndex,
        densities: densityCopy,
      },
      [positions.buffer, indices.buffer, featureIndex.buffer, densityCopy.buffer],
    );
  } catch (error) {
    if (controller.signal.aborted) return;
    const message = error instanceof Error ? error.message : String(error);
    post({ type: "error", requestId, z, x, y, message });
  } finally {
    inflight.delete(requestId);
  }
};

function concatInt16(chunks: Int16Array[]): Int16Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Int16Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function concatUint32(chunks: Uint32Array[]): Uint32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
