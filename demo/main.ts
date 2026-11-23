import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { DotDensityLayer } from "../src/index.ts";

const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/positron",
  center: [-98.5, 39.8],
  zoom: 4.2,
});

const layer = new DotDensityLayer({
  id: "education-dots-debug",
  source: { type: "pmtiles", url: new URL("/counties_edu.pmtiles", window.location.origin).href },
  sourceLayer: "counties",
  fields: ["d_lths", "d_hs", "d_somecol", "d_ba", "d_grad"],
});

const statsEl = document.getElementById("stats");

map.on("load", () => {
  map.addLayer(layer);
});

map.on("render", () => {
  const info = layer.getDebugInfo();
  if (!statsEl || !info) return;
  statsEl.textContent =
    `z ${map.getZoom().toFixed(2)}  ready ${info.ready}  loading ${info.loading}  ` +
    `drawn ${info.drawn}  empty ${info.empty}  aborted ${info.aborted}`;
});
