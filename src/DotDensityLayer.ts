import type { CustomLayerInterface, Map as MapLibreMap } from "maplibre-gl";
import { compileProgram } from "./gl/program.ts";
import { DOT_FS, DOT_VS } from "./gl/shaders.ts";
import { fromColumnMajor, multiply, tileToMercator, toFloat32 } from "./math/mat4.ts";
import {
  cellAreaEquatorKm2,
  cellsPerVectorTile,
  peoplePerDot,
  splitOrigin,
} from "./math/lod.ts";
import { parseColors, premultiply, type ColorInput, type Rgba } from "./color.ts";
import { MAX_GROUPS } from "./gl/densityAtlas.ts";
import { TileManager } from "./tiles/TileManager.ts";
import { readPmtilesZoomRange, type SourceConfig } from "./tiles/sources.ts";

export interface DotDensityLayerOptions {
  id: string;
  source: SourceConfig;
  /** MVT layer name inside each tile (Mapbox `source-layer`). */
  "source-layer": string;
  /** Density field names (people / km²), one group each, at most 8. */
  fields?: string[];
  minzoom?: number;
  maxzoom?: number;
  /** People per dot at `referenceZoom`. */
  dotValue?: number;
  referenceZoom?: number;
  /** 1 = ArcGIS-like (k halves per zoom in). 2 = constant screen density. */
  zoomExponent?: number;
  seed?: number;
  /**
   * One group color. Hex (`#e7298a`), `rgb()` / `rgba()`, or `[r,g,b(,a)]`
   * with 0–1 or 0–255 channels. Prefer `colors` when there are several groups.
   */
  color?: ColorInput;
  /**
   * Group colors, same order as `fields`. Each entry is hex, `rgb()`/`rgba()`,
   * or a numeric channel array.
   */
  colors?: ColorInput[];
}

interface Uniforms {
  matrix: WebGLUniformLocation | null;
  clip: WebGLUniformLocation | null;
  density: WebGLUniformLocation | null;
  extent: WebGLUniformLocation | null;
  cellsPerTile: WebGLUniformLocation | null;
  originInt: WebGLUniformLocation | null;
  originFrac: WebGLUniformLocation | null;
  tileMercY: WebGLUniformLocation | null;
  cellAreaEquatorKm2: WebGLUniformLocation | null;
  peoplePerDot: WebGLUniformLocation | null;
  seed: WebGLUniformLocation | null;
  level: WebGLUniformLocation | null;
  colors: WebGLUniformLocation | null;
  visible: WebGLUniformLocation | null;
  featuresPerRow: WebGLUniformLocation | null;
  layerHeight: WebGLUniformLocation | null;
}

/** MapLibre 5+ options object, or MapLibre 4 / Mapbox: the matrix is `args`. */
function resolveMatrix(args: unknown): ArrayLike<number> {
  const a = args as {
    defaultProjectionData?: { mainMatrix?: ArrayLike<number> };
    modelViewProjectionMatrix?: ArrayLike<number>;
  };
  return a?.defaultProjectionData?.mainMatrix ?? a?.modelViewProjectionMatrix ?? (args as ArrayLike<number>);
}

function loc(gl: WebGL2RenderingContext, program: WebGLProgram, name: string): WebGLUniformLocation | null {
  return gl.getUniformLocation(program, name);
}

export class DotDensityLayer implements CustomLayerInterface {
  id: string;
  type = "custom" as const;
  renderingMode = "2d" as const;

  private readonly options: DotDensityLayerOptions;
  private map: MapLibreMap | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private uniforms: Uniforms | null = null;
  private manager: TileManager | null = null;
  private dotValue: number;
  private seed: number;
  private rgba: Rgba[];
  private colorUniform: Float32Array;
  /** Bit i = 1 means group i is drawn. Hidden groups leave their cells empty. */
  private visibleMask: number;

  constructor(options: DotDensityLayerOptions) {
    if (!options.id) throw new TypeError("id is required");
    const fieldCount = options.fields?.length ?? 0;
    if (fieldCount > MAX_GROUPS) {
      throw new TypeError(`at most ${MAX_GROUPS} density fields, got ${fieldCount}`);
    }
    this.id = options.id;
    this.options = options;
    this.dotValue = options.dotValue ?? 200;
    this.seed = options.seed ?? 1;
    this.rgba = parseColors(options.colors ?? options.color);
    this.colorUniform = packColors(this.rgba);
    this.visibleMask = (1 << Math.max(fieldCount, 1)) - 1;
  }

  setDotValue(value: number): void {
    this.dotValue = value;
    this.map?.triggerRepaint();
  }

  /** Replace group colors. Same formats as the `colors` option. */
  setColors(colors: ColorInput | readonly ColorInput[]): void {
    this.rgba = parseColors(colors);
    this.colorUniform = packColors(this.rgba);
    this.map?.triggerRepaint();
  }

  /**
   * Show or hide a group. Intervals still use every field, so remaining dots
   * stay in the same cells.
   */
  setGroupVisible(index: number, visible: boolean): void {
    if (!Number.isInteger(index) || index < 0 || index >= MAX_GROUPS) {
      throw new RangeError(`group index must be 0..${MAX_GROUPS - 1}`);
    }
    if (visible) this.visibleMask |= 1 << index;
    else this.visibleMask &= ~(1 << index);
    this.map?.triggerRepaint();
  }

  getDebugInfo(): {
    ready: number;
    loading: number;
    empty: number;
    drawn: number;
    aborted: number;
    peoplePerDot: number | null;
  } | null {
    const stats = this.manager?.stats;
    if (!stats || !this.map) return null;
    const referenceZoom = this.options.referenceZoom ?? 10;
    const alpha = this.options.zoomExponent ?? 1;
    return {
      ...stats,
      peoplePerDot: peoplePerDot(this.map.getZoom(), this.dotValue, referenceZoom, alpha),
    };
  }

  onAdd(map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    if (!(gl instanceof WebGL2RenderingContext)) {
      throw new Error("DotDensityLayer requires WebGL2");
    }
    this.map = map;
    this.gl = gl;
    this.program = compileProgram(gl, DOT_VS, DOT_FS);
    this.uniforms = {
      matrix: loc(gl, this.program, "u_matrix"),
      clip: loc(gl, this.program, "u_clip"),
      density: loc(gl, this.program, "u_density"),
      extent: loc(gl, this.program, "u_extent"),
      cellsPerTile: loc(gl, this.program, "u_cellsPerTile"),
      originInt: loc(gl, this.program, "u_originInt"),
      originFrac: loc(gl, this.program, "u_originFrac"),
      tileMercY: loc(gl, this.program, "u_tileMercY"),
      cellAreaEquatorKm2: loc(gl, this.program, "u_cellAreaEquatorKm2"),
      peoplePerDot: loc(gl, this.program, "u_peoplePerDot"),
      seed: loc(gl, this.program, "u_seed"),
      level: loc(gl, this.program, "u_level"),
      colors: loc(gl, this.program, "u_colors[0]"),
      visible: loc(gl, this.program, "u_visible"),
      featuresPerRow: loc(gl, this.program, "u_featuresPerRow"),
      layerHeight: loc(gl, this.program, "u_layerHeight"),
    };
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
      sourceLayer: this.options["source-layer"],
      fields: this.options.fields ?? [],
      minzoom: minzoom ?? 0,
      maxzoom: maxzoom ?? 22,
      onUpdate: () => this.map?.triggerRepaint(),
    });
    map.triggerRepaint();
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, args: unknown): void {
    if (!(gl instanceof WebGL2RenderingContext) || !this.program || !this.uniforms || !this.manager || !this.map) {
      return;
    }

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

    const viewZoom = this.map.getZoom();
    const L = Math.floor(viewZoom);
    const referenceZoom = this.options.referenceZoom ?? 10;
    const alpha = this.options.zoomExponent ?? 1;
    const k = peoplePerDot(viewZoom, this.dotValue, referenceZoom, alpha);
    const mapMatrix = fromColumnMajor(resolveMatrix(args));
    const u = this.uniforms;

    gl.useProgram(this.program);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(u.density, 0);
    gl.uniform1f(u.cellAreaEquatorKm2, cellAreaEquatorKm2(L));
    gl.uniform1f(u.peoplePerDot, k);
    gl.uniform1ui(u.seed, this.seed >>> 0);
    gl.uniform1ui(u.level, L >>> 0);
    gl.uniform4fv(u.colors, this.colorUniform);
    gl.uniform1ui(u.visible, this.visibleMask >>> 0);

    for (const item of draws) {
      const tz = item.tile.z;
      const cells = cellsPerVectorTile(L, tz);
      const { originInt, originFrac } = splitOrigin(item.tile.x, item.tile.y, cells);
      const world = 2 ** tz;
      const tileMatrix = tileToMercator(tz, item.tile.x, item.tile.y, item.resources.extent);
      const mvp = multiply(mapMatrix, tileMatrix);
      gl.uniformMatrix4fv(u.matrix, false, toFloat32(mvp));
      gl.uniform4f(u.clip, ...item.clipRect);
      gl.uniform1f(u.extent, item.resources.extent);
      gl.uniform1f(u.cellsPerTile, cells);
      gl.uniform2i(u.originInt, originInt[0], originInt[1]);
      gl.uniform2f(u.originFrac, originFrac[0], originFrac[1]);
      gl.uniform2f(u.tileMercY, item.tile.y / world, (item.tile.y + 1) / world);
      gl.uniform1i(u.featuresPerRow, item.resources.atlas.featuresPerRow);
      gl.uniform1i(u.layerHeight, item.resources.atlas.layerHeight);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, item.resources.densityTexture);
      gl.bindVertexArray(item.resources.vao);
      gl.drawElements(gl.TRIANGLES, item.resources.indexCount, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  }

  onRemove(): void {
    this.manager?.destroy();
    if (this.gl && this.program) this.gl.deleteProgram(this.program);
    this.manager = null;
    this.program = null;
    this.uniforms = null;
    this.map = null;
    this.gl = null;
  }
}

function packColors(rgba: Rgba[]): Float32Array {
  const out = new Float32Array(MAX_GROUPS * 4);
  const last = rgba[rgba.length - 1] ?? ([1, 0, 0, 1] satisfies Rgba);
  for (let i = 0; i < MAX_GROUPS; i++) {
    const pm = premultiply(rgba[i] ?? last);
    out.set(pm, i * 4);
  }
  return out;
}
