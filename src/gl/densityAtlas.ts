/** Two RGBA32F texels hold groups 0–3 and 4–7. */
export const MAX_GROUPS = 8;
export const TEXELS_PER_FEATURE = 2;

export interface DensityAtlasLayout {
  /** Texture width in texels (always even). */
  texWidth: number;
  featuresPerRow: number;
  /** Rows in each array layer. */
  layerHeight: number;
  layers: number;
}

/**
 * Fit `featureCount` records into a `TEXTURE_2D_ARRAY` the GPU can allocate.
 *
 * WebGL2 guarantees MAX_TEXTURE_SIZE ≥ 2048 and MAX_ARRAY_TEXTURE_LAYERS ≥ 256.
 * A 2048² layer holds ~2.1M features (2 texels each). All US block groups
 * (~315k) fit in one thin layer. ~8M census blocks need a few layers on a
 * 2048 GPU, still well under 256.
 */
export function densityAtlasLayout(
  gl: WebGL2RenderingContext,
  featureCount: number,
): DensityAtlasLayout {
  const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const maxLayers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number;
  const featuresPerRow = Math.floor(maxSize / TEXELS_PER_FEATURE);
  const texWidth = featuresPerRow * TEXELS_PER_FEATURE;
  const rowsNeeded = Math.max(1, Math.ceil(Math.max(featureCount, 1) / featuresPerRow));
  if (rowsNeeded <= maxSize) {
    return { texWidth, featuresPerRow, layerHeight: rowsNeeded, layers: 1 };
  }
  const layers = Math.ceil(rowsNeeded / maxSize);
  if (layers > maxLayers) {
    throw new Error(
      `tile has ${featureCount} features; need ${layers} texture layers but this GPU ` +
        `only allows ${maxLayers} (MAX_TEXTURE_SIZE=${maxSize})`,
    );
  }
  return { texWidth, featuresPerRow, layerHeight: maxSize, layers };
}

export function packDensityAtlas(
  layout: DensityAtlasLayout,
  featureCount: number,
  densities: Float32Array,
): Float32Array {
  const { texWidth, featuresPerRow, layerHeight, layers } = layout;
  const pixels = new Float32Array(texWidth * layerHeight * layers * 4);
  const groupCount = featureCount > 0 ? densities.length / featureCount : 1;
  const packed = Math.min(groupCount, MAX_GROUPS);
  const featuresPerLayer = featuresPerRow * layerHeight;
  for (let f = 0; f < featureCount; f++) {
    const layer = Math.floor(f / featuresPerLayer);
    const local = f - layer * featuresPerLayer;
    const x0 = (local % featuresPerRow) * TEXELS_PER_FEATURE;
    const y = Math.floor(local / featuresPerRow);
    const base = ((layer * layerHeight + y) * texWidth + x0) * 4;
    for (let g = 0; g < packed; g++) {
      pixels[base + g] = densities[f * groupCount + g] ?? 0;
    }
  }
  return pixels;
}
