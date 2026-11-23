import { PMTiles } from "pmtiles";

export type SourceConfig =
  | {
      type: "pmtiles";
      url: string;
      minzoom?: number;
      maxzoom?: number;
    }
  | {
      type: "xyz";
      tiles: string[];
      minzoom?: number;
      maxzoom?: number;
    };

const pmtilesByUrl = new Map<string, PMTiles>();

function pmtiles(url: string): PMTiles {
  let archive = pmtilesByUrl.get(url);
  if (!archive) {
    archive = new PMTiles(url);
    pmtilesByUrl.set(url, archive);
  }
  return archive;
}

function xyzUrl(templates: string[], z: number, x: number, y: number): string {
  const template = templates[(x + y) % templates.length];
  return template
    .replaceAll("{z}", String(z))
    .replaceAll("{x}", String(x))
    .replaceAll("{y}", String(y))
    .replaceAll("{-y}", String((1 << z) - 1 - y));
}

async function maybeGunzip(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  const view = new Uint8Array(bytes);
  if (view.length < 2 || view[0] !== 0x1f || view[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).arrayBuffer();
}

export async function getTileBytes(
  source: SourceConfig,
  z: number,
  x: number,
  y: number,
  signal: AbortSignal,
): Promise<ArrayBuffer | null> {
  if (source.type === "pmtiles") {
    const result = await pmtiles(source.url).getZxy(z, x, y, signal);
    return result?.data ?? null;
  }
  const url = xyzUrl(source.tiles, z, x, y);
  const response = await fetch(url, { signal });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`tile ${z}/${x}/${y}: HTTP ${response.status}`);
  }
  return maybeGunzip(await response.arrayBuffer());
}

export async function readPmtilesZoomRange(
  url: string,
): Promise<{ minzoom: number; maxzoom: number }> {
  const header = await pmtiles(url).getHeader();
  return { minzoom: header.minZoom, maxzoom: header.maxZoom };
}
