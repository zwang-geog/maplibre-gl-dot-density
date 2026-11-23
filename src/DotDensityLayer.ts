import type { CustomLayerInterface, Map as MapLibreMap } from "maplibre-gl";
import { compileProgram } from "./gl/program.ts";
import { DEBUG_FS, DEBUG_VS } from "./gl/shaders.ts";
import { fromColumnMajor, multiply, tileToMercator, toFloat32 } from "./math/mat4.ts";
import { TileManager } from "./tiles/TileManager.ts";
import { readPmtilesZoomRange, type SourceConfig } from "./tiles/sources.ts";
import type { TileId } from "./tiles/ids.ts";

export interface DotDensityLayerOptions {
  id: string;
  source: SourceConfig;
  sourceLayer: string;
  /** Density field names. Unused in the debug-color milestone, still decoded. */
  fields?: string[];
  minzoom?: number;
  maxzoom?: number;
}

function resolveMatrix(args: unknown): ArrayLike<number> {
  if (args && typeof args === "object") {
    const record = args as Record<string, unknown>;
    const fromProjection = (record.defaultProjectionData as { mainMatrix?: ArrayLike<number> } | undefined)
      ?.mainMatrix;
    if (fromProjection) return fromProjection;
    if (record.modelViewProjectionMatrix) {
      return record.modelViewProjectionMatrix as ArrayLike<number>;
    }
  }
  return args as ArrayLike<number>;
}

function debugColor(tile: TileId, placeholder: boolean): [number, number, number, number] {
  const n = (tile.x * 374761393 + tile.y * 668265263 + tile.z * 1274126177) >>> 0;
  const r = ((n) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = ((n >> 16) & 255) / 255;
  const a = placeholder ? 0.45 : 0.7;
  return [r * a, g * a, b * a, a];
}

export class DotDensityLayer implements CustomLayerInterface {
  id: string;
  type = "custom" as const;
  renderingMode = "2d" as const;

  private readonly options: DotDensityLayerOptions;
  private map: MapLibreMap | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private manager: TileManager | null = null;
  private locMatrix: WebGLUniformLocation | null = null;
  private locClip: WebGLUniformLocation | null = null;
  private locColor: WebGLUniformLocation | null = null;

  constructor(options: DotDensityLayerOptions) {
    if (!options.id) throw new TypeError("id is required");
    this.id = options.id;
    this.options = options;
  }

  getDebugInfo(): { ready: number; loading: number; empty: number; drawn: number; aborted: number } | null {
    return this.manager?.stats ?? null;
  }

  onAdd(map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    if (!(gl instanceof WebGL2RenderingContext)) {
      throw new Error("DotDensityLayer requires WebGL2");
    }
    this.map = map;
    this.gl = gl;
    this.program = compileProgram(gl, DEBUG_VS, DEBUG_FS);
    this.locMatrix = gl.getUniformLocation(this.program, "u_matrix");
    this.locClip = gl.getUniformLocation(this.program, "u_clip");
    this.locColor = gl.getUniformLocation(this.program, "u_color");
    void this.start(map, gl);
  }

  private async start(map: MapLibreMap, gl: WebGL2RenderingContext): Promise<void> {
    let minzoom = this.options.minzoom;
    let maxzoom = this.options.maxzoom;
    if (this.options.source.type === "pmtiles" && (minzoom === undefined || maxzoom === undefined)) {
      const range = await readPmtilesZoomRange(this.options.source.url);
      minzoom ??= range.minzoom;
      maxzoom ??= range.maxzoom;
    }
    if (this.gl !== gl || !this.program) return;
    this.manager = new TileManager({
      gl,
      program: this.program,
      source: this.options.source,
      sourceLayer: this.options.sourceLayer,
      fields: this.options.fields ?? [],
      minzoom: minzoom ?? 0,
      maxzoom: maxzoom ?? 22,
      onUpdate: () => this.map?.triggerRepaint(),
    });
    map.triggerRepaint();
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, args: unknown): void {
    if (!(gl instanceof WebGL2RenderingContext) || !this.program || !this.manager || !this.map) return;

    const bounds = this.map.getBounds();
    const draws = this.manager.setView(
      {
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      },
      this.map.getZoom(),
    );

    const mapMatrix = fromColumnMajor(resolveMatrix(args));
    gl.useProgram(this.program);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);

    for (const item of draws) {
      const tileMatrix = tileToMercator(item.tile.z, item.tile.x, item.tile.y, item.resources.extent);
      const mvp = multiply(mapMatrix, tileMatrix);
      gl.uniformMatrix4fv(this.locMatrix, false, toFloat32(mvp));
      gl.uniform4f(this.locClip, ...item.clipRect);
      gl.uniform4f(this.locColor, ...debugColor(item.tile, item.placeholder));
      gl.bindVertexArray(item.resources.vao);
      gl.drawElements(gl.TRIANGLES, item.resources.indexCount, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }

  onRemove(): void {
    this.manager?.destroy();
    if (this.gl && this.program) this.gl.deleteProgram(this.program);
    this.manager = null;
    this.program = null;
    this.map = null;
    this.gl = null;
  }
}
