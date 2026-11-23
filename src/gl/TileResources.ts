import type { TileGeometryResult } from "../worker/protocol.ts";

export class TileResources {
  readonly vao: WebGLVertexArrayObject;
  readonly positionBuffer: WebGLBuffer;
  readonly indexBuffer: WebGLBuffer;
  readonly indexCount: number;
  readonly extent: number;
  readonly featureCount: number;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    tile: TileGeometryResult,
    program: WebGLProgram,
  ) {
    const vao = gl.createVertexArray();
    const positionBuffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    if (!vao || !positionBuffer || !indexBuffer) {
      throw new Error("failed to allocate tile GL buffers");
    }
    this.vao = vao;
    this.positionBuffer = positionBuffer;
    this.indexBuffer = indexBuffer;
    this.indexCount = tile.indexCount;
    this.extent = tile.extent;
    this.featureCount = tile.featureCount;

    const loc = gl.getAttribLocation(program, "a_pos");
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, tile.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.SHORT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, tile.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  }

  destroy(): void {
    const { gl } = this;
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.positionBuffer);
    gl.deleteBuffer(this.indexBuffer);
  }
}
