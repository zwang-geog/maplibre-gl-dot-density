import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { DotDensityLayer } from "../src/index.ts";

const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/dark",
  center: [-98.5, 39.8],
  zoom: 4.2,
});

const layer = new DotDensityLayer({
  id: "education-dots-ba",
  source: { type: "pmtiles", url: new URL("/counties_edu.pmtiles", window.location.origin).href },
  sourceLayer: "counties",
  fields: ["d_ba"],
  color: [231,41,138,255],
  dotValue: 200,
  referenceZoom: 10,
  zoomExponent: 1,
});

const statsEl = document.getElementById("stats");

map.on("load", () => {
  map.addLayer(layer);
});

map.on("render", () => {
  const info = layer.getDebugInfo();
  if (!statsEl || !info) return;
  statsEl.textContent =
    `z ${map.getZoom().toFixed(2)}  k ${info.peoplePerDot?.toFixed(0)} people/dot  ` +
    `ready ${info.ready}  loading ${info.loading}  ` +
    `drawn ${info.drawn}  empty ${info.empty}  aborted ${info.aborted}`;
});
