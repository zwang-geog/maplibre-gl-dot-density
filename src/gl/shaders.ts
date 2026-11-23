export const DOT_VS = `#version 300 es
in vec2 a_pos;
in uint a_feature;
uniform mat4 u_matrix;
out vec2 v_local;
flat out uint v_feature;
void main() {
  v_local = a_pos;
  v_feature = a_feature;
  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
}
`;

export const DOT_FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_local;
flat in uint v_feature;
uniform highp sampler2D u_density;
uniform vec4 u_clip;
uniform float u_extent;
uniform float u_cellsPerTile;
uniform ivec2 u_originInt;
uniform vec2 u_originFrac;
uniform vec2 u_tileMercY;
uniform float u_cellAreaEquatorKm2;
uniform float u_peoplePerDot;
uniform uint u_seed;
uniform uint u_level;
uniform vec4 u_color;
out vec4 fragColor;

uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}

void main() {
  if (any(lessThan(v_local, u_clip.xy)) || any(greaterThanEqual(v_local, u_clip.zw))) discard;

  // One CSS pixel at integer zoom L. Lit = fill the pixel, else discard.
  vec2 t = u_originFrac + (v_local / u_extent) * u_cellsPerTile;
  ivec2 cell = u_originInt + ivec2(floor(t));

  uvec3 h = pcg3d(uvec3(uvec2(cell), u_seed ^ (u_level * 0x9E3779B9u)));
  float u = float(h.x) * (1.0 / 4294967296.0);

  float mercY = mix(u_tileMercY.x, u_tileMercY.y, v_local.y / u_extent);
  float cosLat = 1.0 / cosh(3.14159265 * (1.0 - 2.0 * mercY));
  float cellKm2 = u_cellAreaEquatorKm2 * cosLat * cosLat;

  vec4 rho = texelFetch(u_density, ivec2(int(v_feature) % 1024, int(v_feature) / 1024), 0);
  float p = min(rho.r * cellKm2 / u_peoplePerDot, 1.0);
  if (u >= p) discard;

  fragColor = u_color;
}
`;
