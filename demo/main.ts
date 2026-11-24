import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { DotDensityLayer } from "../src/index.ts";

const GROUPS = [
  { field: "d_lths", label: "< HS", color: "#d73027" },
  { field: "d_hs", label: "HS", color: "#fc8d59" },
  { field: "d_somecol", label: "some col", color: "#fee090" },
  { field: "d_ba", label: "BA", color: "#91bfdb" },
  { field: "d_grad", label: "grad", color: "#4575b4" },
] as const;

const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/dark",
  center: [-98.5, 39.8],
  zoom: 4.2,
});

const layer = new DotDensityLayer({
  id: "education-dots",
  source: { type: "pmtiles", url: new URL("/counties_edu.pmtiles", window.location.origin).href },
  sourceLayer: "counties",
  fields: GROUPS.map((g) => g.field),
  colors: GROUPS.map((g) => g.color),
  dotValue: 200,
  referenceZoom: 10,
  zoomExponent: 1,
});

const statsEl = document.getElementById("stats");
const legendEl = document.getElementById("legend");
const visible = GROUPS.map(() => true);

if (legendEl) {
  for (let i = 0; i < GROUPS.length; i++) {
    const g = GROUPS[i];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.index = String(i);
    btn.innerHTML = `<span class="swatch" style="background:${g.color}"></span>${g.label}`;
    btn.addEventListener("click", () => {
      visible[i] = !visible[i];
      btn.classList.toggle("off", !visible[i]);
      layer.setGroupVisible(i, visible[i]);
    });
    legendEl.append(btn);
  }
}

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
