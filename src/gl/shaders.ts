/**
 * WebGL2 (GLSL ES 3.00) programs for stochastic per-pixel dots.
 *
 * We draw ordinary filled triangles. The vertex shader only places them on
 * screen. The fragment shader decides, for each pixel inside a polygon,
 * whether that world-anchored 1px cell is a “dot” and which group color it
 * gets. Expected dots in a cell is p = ρ · cellArea / k; one hash roll picks
 * at most one group (ArcGIS-style, no blending).
 */

export const DOT_VS = `#version 300 es

// Tile-local vertex, usually 0..extent (often 4096). Same units as MVT.
in vec2 a_pos;

// Which polygon this vertex belongs to. All vertices of one feature share
// one id, used in the fragment shader to look up densities.
in uint a_feature;

// Tile-local → clip space. CPU: MapLibre camera matrix × tile-to-mercator.
uniform mat4 u_matrix;

// Pass position through so the fragment shader can recover the cell id.
out vec2 v_local;

// "flat": every fragment of a triangle gets the provoking vertex's id,
// not an interpolation of three uints (which is not defined).
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

// Interpolated tile-local xy from the vertex shader.
in vec2 v_local;

// Feature id (constant across a triangle). uint, not ushort: a z0-style
// tile can contain hundreds of thousands of block groups.
flat in uint v_feature;

// RGBA32F array: two texels per feature.
// Texel (2i, y, layer) = groups 0–3 (people / km²).
// Texel (2i+1, y, layer) = groups 4–7. Unused groups are 0.
// Width / height / layer count come from the GPU's MAX_TEXTURE_SIZE so
// one tile can hold all US block groups, and census blocks with a few layers.
uniform highp sampler2DArray u_density;
uniform int u_featuresPerRow;
uniform int u_layerHeight;

// Parent-placeholder clip in tile-local units (minX, minY, maxX, maxY).
// Fragments outside are discarded so a parent tile does not draw over
// a child that already occupies that quadrant.
uniform vec4 u_clip;

// MVT layer extent (e.g. 4096). v_local / u_extent is 0..1 across the tile.
uniform float u_extent;

// How many 1px cells fit along one edge of this vector tile at LOD L.
// = 512 · 2^(L − tz). May be < 1 when drawing a child placeholder.
uniform float u_cellsPerTile;

// World cell origin of this tile, split so ids stay exact in float32:
// origin = originInt + originFrac, computed in float64 on the CPU.
uniform ivec2 u_originInt;
uniform vec2 u_originFrac;

// Mercator y of the tile's top and bottom (0 at north pole, 1 at south).
// Only used to get cos(latitude) for cell ground area.
uniform vec2 u_tileMercY;

// Ground area of one 1px cell at the equator, km², at integer zoom L.
// Real area at this fragment is this times cos²(lat).
uniform float u_cellAreaEquatorKm2;

// People per dot k(L). p_g = ρ_g · cellKm2 / k.
uniform float u_peoplePerDot;

// Mixes into the hash so a different seed re-rolls every cell.
uniform uint u_seed;

// Integer LOD L = floor(view zoom). XORed into the hash so dots re-roll
// when the cell grid and k change at a zoom integer.
uniform uint u_level;

// Premultiplied RGBA for groups 0–7. Extra slots unused if fewer fields.
uniform vec4 u_colors[8];

// Bit i = 1 → draw group i. Filter is applied *after* choosing a group,
// so hiding a group leaves a hole instead of shifting the others.
uniform uint u_visible;

// Premultiplied output. Opaque for a lit cell, or the fragment is discarded.
out vec4 fragColor;

// Cheap 3D hash (hashing-in-shader / pcg3d). Input (cell.x, cell.y, seed)
// → three well-mixed uints. We only use .x as the uniform roll in [0, 1).
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}

void main() {
  // Placeholder clip: drop fragments that belong to a more detailed child.
  if (any(lessThan(v_local, u_clip.xy)) || any(greaterThanEqual(v_local, u_clip.zw))) discard;

  // Map this fragment onto the world-anchored 1px grid at level L.
  // t is the cell coordinate in continuous units; floor(t) is the cell id
  // relative to this tile, then add originInt.
  vec2 t = u_originFrac + (v_local / u_extent) * u_cellsPerTile;
  ivec2 cell = u_originInt + ivec2(floor(t));

  // One deterministic roll per cell. Same cell → same u in every tile and
  // every frame, until L or the seed changes. 1/2^32 maps uint → [0, 1).
  uvec3 h = pcg3d(uvec3(uvec2(cell), u_seed ^ (u_level * 0x9E3779B9u)));
  float u = float(h.x) * (1.0 / 4294967296.0);

  // Mercator y → WGS84 latitude: lat = atan(sinh(π (1 − 2 y))).
  // Then cos(lat) = 1 / cosh(π (1 − 2 y)). Cell area scales with cos²(lat)
  // because mercator pixels shrink in ground size toward the poles.
  float mercY = mix(u_tileMercY.x, u_tileMercY.y, v_local.y / u_extent);
  float cosLat = 1.0 / cosh(3.14159265 * (1.0 - 2.0 * mercY));
  float cellKm2 = u_cellAreaEquatorKm2 * cosLat * cosLat;
  float scale = cellKm2 / u_peoplePerDot;

  // Densities ρ_g for this polygon (people / km²), then expected dots p_g.
  // Walk the atlas: row-major within a layer, then the next array layer.
  uint fpr = uint(u_featuresPerRow);
  uint lh = uint(u_layerHeight);
  uint perLayer = fpr * lh;
  uint layer = v_feature / perLayer;
  uint local = v_feature - layer * perLayer;
  int fx = int(local % fpr);
  int fy = int(local / fpr);
  vec4 rho0 = texelFetch(u_density, ivec3(fx * 2, fy, int(layer)), 0);
  vec4 rho1 = texelFetch(u_density, ivec3(fx * 2 + 1, fy, int(layer)), 0);
  vec4 p0 = rho0 * scale;
  vec4 p1 = rho1 * scale;

  // Saturation: a cell can hold at most one dot. If the groups together
  // want more than one, shrink them so they still share the cell in the
  // same proportions and the cell is always filled.
  float sum = p0.x + p0.y + p0.z + p0.w + p1.x + p1.y + p1.z + p1.w;
  if (sum > 1.0) {
    p0 /= sum;
    p1 /= sum;
    sum = 1.0;
  }

  // Walk cumulative intervals:
  //   [0, p0) → group 0, [p0, p0+p1) → group 1, …  u ≥ Σp → no dot.
  // Hidden groups keep their interval; we discard after the pick.
  int g = -1;
  float acc = p0.x; if (u < acc) g = 0;
  acc += p0.y; if (g < 0 && u < acc) g = 1;
  acc += p0.z; if (g < 0 && u < acc) g = 2;
  acc += p0.w; if (g < 0 && u < acc) g = 3;
  acc += p1.x; if (g < 0 && u < acc) g = 4;
  acc += p1.y; if (g < 0 && u < acc) g = 5;
  acc += p1.z; if (g < 0 && u < acc) g = 6;
  if (g < 0 && u < sum) g = 7;
  if (g < 0 || (u_visible & (1u << uint(g))) == 0u) discard;

  // Lit cell: fill the whole pixel with that group's color.
  fragColor = u_colors[g];
}
`;
