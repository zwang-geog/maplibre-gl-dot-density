/** Column-major 4×4, float64. */
export type Mat4 = Float64Array;

export function identity(): Mat4 {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function fromColumnMajor(values: ArrayLike<number>): Mat4 {
  const m = new Float64Array(16);
  for (let i = 0; i < 16; i++) m[i] = values[i] ?? 0;
  return m;
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const o = new Float64Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      o[col * 4 + row] =
        a[row] * b[col * 4] +
        a[row + 4] * b[col * 4 + 1] +
        a[row + 8] * b[col * 4 + 2] +
        a[row + 12] * b[col * 4 + 3];
    }
  }
  return o;
}

/** Maps tile-local (0..extent) to Web Mercator [0,1]. */
export function tileToMercator(z: number, x: number, y: number, extent: number): Mat4 {
  const world = 2 ** z;
  const s = 1 / (world * extent);
  const m = identity();
  m[0] = s;
  m[5] = s;
  m[12] = x / world;
  m[13] = y / world;
  return m;
}

export function toFloat32(m: Mat4): Float32Array {
  return new Float32Array(m);
}
