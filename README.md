# maplibre-gl-dot-density

[![npm version](https://img.shields.io/npm/v/maplibre-gl-dot-density)](https://www.npmjs.com/package/maplibre-gl-dot-density)

**Add a dot density layer to MapLibre GL JS or Mapbox GL JS. It paints random 1-pixel dots inside polygons so populated places look lit and sparsely populated places look dim — for population density or any other geographic density.**

## Data

The layer does not take GeoJSON at runtime. It reads **polygon vector tiles** whose attributes are already **densities**, not raw counts.

**1. Polygon attributes.** Start from features such as census tracts or block groups. Each feature needs one or more numeric properties in **count per km²** — for example people per km², or bachelor’s degrees per km². The area unit must be square kilometres. Prefer a **geodesic** area (not a planar Mercator area), and **exclude water** when that water is not part of the population you are mapping.

**2. Tiles.** Convert those polygons to Mapbox Vector Tiles with a tool such as [tippecanoe](https://github.com/mapbox/tippecanoe). Two usual ways to serve them:

- **MBTiles**, then a tile server such as [Martin](https://maplibre.org/martin/quick-start/), which gives you an **XYZ** URL (`…/{z}/{x}/{y}`).
- **PMTiles**, uploaded to S3 (or anything that speaks HTTP range requests) so the client can fetch bytes **without** a tile server.

## Install

```bash
npm install maplibre-gl-dot-density
```

Install **one** map runtime as well:

```bash
npm install maplibre-gl
# or
npm install mapbox-gl
```

**MapLibre v5 and v6 are not interchangeable.** v6 is ESM-only and, with Vite or another bundler, you must set the map worker URL (`setWorkerUrl`). Follow the [MapLibre install guide](https://maplibre.org/maplibre-gl-js/docs/#__tabbed_1_1) for the version and bundler you actually use.

When you construct a **Mapbox** map, set `projection: "mercator"`. Most Mapbox styles default to globe; this layer only works in **Mercator**.

```js
const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/dark-v11",
  projection: "mercator",
  // accessToken: "…"
});
```

## Usage

Construct a `DotDensityLayer` with the tile source, the layer id, density fields, color(s), and how many people (or other count) each dot stands for. `source` is one of two shapes: **`pmtiles`** (a URL to a `.pmtiles` archive) or **`xyz`** (one or more tile URL templates with `{z}`, `{x}`, `{y}`).

You can specify **multiple density attributes** to show subcategories of the same population. For example, instead of one “adults” field you might split educational attainment so each red dot is 200 people without a high school diploma, each orange dot 200 high-school graduates, each yellow dot 200 with some college, and so on. The snippet below uses those five education fields.

```ts
import { DotDensityLayer } from "maplibre-gl-dot-density";

const layer = new DotDensityLayer({
  id: "education-dots",
  source: { type: "pmtiles", url: "https://example.com/counties_edu.pmtiles" },
  // source: { type: "xyz", tiles: ["https://tiles.example.com/{z}/{x}/{y}.pbf"] },
  "source-layer": "counties",
  minzoom: 4, // source tile range (tippecanoe -Z / -z), not the map layer minzoom
  maxzoom: 10,
  fields: ["d_lths", "d_hs", "d_somecol", "d_ba", "d_grad"],
  colors: ["#d73027", "#fc8d59", "#fee090", "#91bfdb", "#4575b4"],
  dotValue: 200,
  referenceZoom: 10,
  zoomExponent: 1, // 1 = ArcGIS-like (k halves each zoom-in); 2 = constant screen density
});
```

Add it with `addLayer`, the same as a fill or circle layer. Wait until the style is ready:

```ts
map.on("style.load", () => {
  map.addLayer(layer);
});
```

The layer is drawn as soon as it is added. Show or hide the whole layer with the `visibility` layout property. The first argument is the layer id:

```js
map.setLayoutProperty("education-dots", "visibility", "visible"); // show
map.setLayoutProperty("education-dots", "visibility", "none"); // hide
```

Each entry in `fields` is one **subcategory** (below high school, high school, some college, bachelor’s, graduate in the example). `setGroupVisible` takes that list’s **0-based index** so you can show or hide one subcategory at a time. Passing `3` hides `d_ba` (bachelor’s). Cells already painted for the other subcategories stay as they are; they are not redrawn or reassigned.

```ts
layer.setGroupVisible(3, false);
```


> [!WARNING]
> Do not interpret the map by counting dots in a polygon. The number of dots is an **approximation** meant for a quick look at the **general** population pattern, not a census of that feature. In very dense places the dots pack together and the picture is weaker than a choropleth of density, especially when you are zoomed out.

## Options

| option | role |
| --- | --- |
| `id` | Layer id |
| `source` | `{ type: "pmtiles", url: string }` or `{ type: "xyz", tiles: string[] }` (`{z}/{x}/{y}` templates) |
| `source-layer` | MVT layer name inside each tile |
| `minzoom` | Lowest tile zoom to request. Below this, the layer **does not fetch tiles**. Must match the tiles you generated |
| `maxzoom` | Highest tile zoom. Above this, the layer **keeps requesting `maxzoom` tiles** (overzoom). Must match the tiles you generated |
| `fields` | `string[]` of density property names (people / km²). **1–8** entries; each is one subcategory |
| `color` | One color when the count is not split into subcategories ([see below](#colors)) |
| `colors` | `ColorInput[]` in `fields` order ([see below](#colors)) |
| `dotValue` | People per dot at `referenceZoom` (default 200); [see below](#from-density-to-dots) |
| `referenceZoom` | Zoom where `dotValue` applies (default 10); [see below](#from-density-to-dots) |
| `zoomExponent` | How `dotValue` changes with zoom (default `1`); [see below](#from-density-to-dots) |
| `seed` | Hash seed; change it to re-roll every cell |

`minzoom` and `maxzoom` should be the same zoom range tippecanoe (or your tile server) actually produced. They are not the map’s camera limits. If you omit them for a **PMTiles** archive, the layer reads the range from the file header. For **XYZ**, you must set them yourself; the fallbacks `0` and `22` will request zooms that do not exist. Set them too low or too high and you get empty maps, 404s, or needless traffic.

### Colors

Use **`color`** when the population (or other count) is **not** divided into subcategories: one hex string (`#e7298a`), CSS `rgb()` / `rgba()`, or a numeric channel array `[r, g, b]` / `[r, g, b, a]`. If any RGB channel is greater than 1, the array is treated as 0–255; otherwise 0–1.

Use **`colors`** when there are several subcategories. It is an array of those same kinds of values, **same order and length as `fields`**.

If you set **both**, `colors` is used and `color` is ignored. If you set neither, the layer defaults to opaque red. Extra slots beyond `fields.length` are unused; if `colors` is shorter than `fields`, remaining subcategories reuse the last color.

### From density to dots

The tiles store **density** `ρ` on each polygon (count per km²). The layer never stores a list of dots. For every 1-pixel **cell** inside a polygon it estimates how many dots that cell should hold, then either paints the cell or leaves it empty.

Three quantities go into that estimate:

1. **`ρ`** — from the feature attribute (`fields`). You compute this when building the tiles (geodesic km², as in [Data](#data)).
2. **People per dot `k`** — what you set with `dotValue` and `referenceZoom`, then **scaled with zoom**. At integer zoom `L = floor(zoom)`:

   `k(L) = max(1, dotValue × 2^(−zoomExponent × (L − referenceZoom)))`

   So `dotValue` is the number of people (or other count) **one dot represents at `referenceZoom`**. Zoom in and `k` shrinks; zoom out and `k` grows. `zoomExponent` (`α`) is that rate:
   - **`1`** (default, ArcGIS-like): `k` halves each time you zoom in one integer level, so twice as many dots, but the map’s screen area grew 4×, so the stipple looks **sparser**.
   - **`2`**: `k` drops by 4× per level you zoom in, so **screen density stays about constant**.

3. **Cell area `a`** — computed internally, not an option. A cell is one CSS pixel of the world-anchored grid at `L`. Ground area is the equatorial 1px square at that zoom, scaled by `cos²(latitude)` because Mercator pixels cover less ground toward the poles.

Expected dots in the cell are `p = ρ × a / k`. A deterministic hash for that cell draws a number `u` in `[0, 1)`. If `u < p` the cell is lit (and if several `fields` share the cell, `u` picks **at most one** subcategory). If `p > 1`, the cell wants more than one dot; the layer still paints it once and **undercounts** (dense places go solid at low zoom). Raise `dotValue` or zoom in to push `p` back under 1.


## Methods

1. Show or hide one subcategory. `index` is the 0-based position in `fields` (`0` … `fields.length - 1`).

```ts
setGroupVisible(index: number, visible: boolean): void
```

2. Replace subcategory colors. Same formats as the `color` / `colors` options (hex, `rgb()` / `rgba()`, or a channel array; pass an array of those for several subcategories).

```ts
setColors(colors: ColorInput | readonly ColorInput[]): void
```

3. Set people (or other count) per dot at `referenceZoom`. Zoom scaling still uses `zoomExponent`.

```ts
setDotValue(value: number): void
```

4. Tile-pipeline stats and the current `k` (`peoplePerDot`). Returns `null` until the layer is on the map.

```ts
getDebugInfo(): {
  ready: number;
  loading: number;
  empty: number;
  drawn: number;
  aborted: number;
  peoplePerDot: number | null;
} | null
```

## TypeScript

The package is written in TypeScript and re-exports these from the main entry (`maplibre-gl-dot-density`), besides the `DotDensityLayer` class:

| export | kind | role |
| --- | --- | --- |
| `DotDensityLayerOptions` | type | Constructor argument; `source` is a `SourceConfig` |
| `SourceConfig` | type | `{ type: "pmtiles", url: string }` or `{ type: "xyz", tiles: string[] }`. Tile zoom range is **not** set here — use constructor `minzoom` / `maxzoom` |
| `ColorInput` | type | `string \| readonly number[]` — hex, `rgb()` / `rgba()`, or a channel array |
| `Rgba` | type | `[r, g, b, a]` in 0–1, straight (not premultiplied) |
| `parseColor` | function | `(input: ColorInput) => Rgba` |
| `parseColors` | function | `(input: ColorInput \| readonly ColorInput[] \| undefined) => Rgba[]` |
| `MAX_GROUPS` | constant | `8` — maximum length of `fields` |

```ts
import {
  DotDensityLayer,
  MAX_GROUPS,
  parseColor,
  type ColorInput,
  type DotDensityLayerOptions,
  type SourceConfig,
} from "maplibre-gl-dot-density";
```

## Acknowledgements

The stochastic, per-cell model — density × cell area / people-per-dot, a seeded roll, `dotValue` with a reference zoom, and several attributes sharing one map — follows ArcGIS’s [`DotDensityRenderer`](https://developers.arcgis.com/javascript/latest/references/core/renderers/DotDensityRenderer/) (ArcGIS Maps SDK for JavaScript). Public write-ups of that renderer shaped this package:

- [Dot density for the web](https://www.esri.com/arcgis-blog/products/js-api-arcgis/mapping/dot-density-for-the-web) (Esri blog)
- [BUG-000163492](https://support.esri.com/en-us/bug/the-dotdensityrenderer-in-arcgis-maps-sdk-for-javascrip-bug-000163492), which describes the algorithm

This library is not affiliated with Esri. Differences (tiled MVT densities, 1-pixel cells, MapLibre / Mapbox) are ours.

