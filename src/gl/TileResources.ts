import type { TileGeometryResult } from "../worker/protocol.ts";
import {
  densityAtlasLayout,
  packDensityAtlas,
  type DensityAtlasLayout,
} from "./densityAtlas.ts";

export class TileResources {
  readonly vao: WebGLVertexArrayObject;
  readonly positionBuffer: WebGLBuffer;
  readonly featureBuffer: WebGLBuffer;
  readonly indexBuffer: WebGLBuffer;
  readonly densityTexture: WebGLTexture;
  readonly indexCount: number;
  readonly extent: number;
  readonly featureCount: number;
  readonly atlas: DensityAtlasLayout;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    tile: TileGeometryResult,
    program: WebGLProgram,
  ) {
    const vao = gl.createVertexArray();
    const positionBuffer = gl.createBuffer();
    const featureBuffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    const densityTexture = gl.createTexture();
    if (!vao || !positionBuffer || !featureBuffer || !indexBuffer || !densityTexture) {
      throw new Error("failed to allocate tile GL resources");
    }
    this.vao = vao;
    this.positionBuffer = positionBuffer;
    this.featureBuffer = featureBuffer;
    this.indexBuffer = indexBuffer;
    this.densityTexture = densityTexture;
    this.indexCount = tile.indexCount;
    this.extent = tile.extent;
    this.featureCount = tile.featureCount;

    const posLoc = gl.getAttribLocation(program, "a_pos");
    const featLoc = gl.getAttribLocation(program, "a_feature");
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, tile.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.SHORT, false, 0, 0);

    // uint32 ids so a single low-zoom tile can hold every US block group
    // (~315k) or a few million census blocks. uint16 would wrap at 65,535.
    gl.bindBuffer(gl.ARRAY_BUFFER, featureBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, tile.featureIndex, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(featLoc);
    gl.vertexAttribIPointer(featLoc, 1, gl.UNSIGNED_INT, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, tile.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    const atlas = densityAtlasLayout(gl, tile.featureCount);
    this.atlas = atlas;
    const pixels = packDensityAtlas(atlas, tile.featureCount, tile.densities);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, densityTexture);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      gl.RGBA32F,
      atlas.texWidth,
      atlas.layerHeight,
      atlas.layers,
      0,
      gl.RGBA,
      gl.FLOAT,
      pixels,
    );
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  }

  destroy(): void {
    const { gl } = this;
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.positionBuffer);
    gl.deleteBuffer(this.featureBuffer);
    gl.deleteBuffer(this.indexBuffer);
    gl.deleteTexture(this.densityTexture);
  }
}
