# Local demo

A MapLibre map with five educational-attainment density fields on US counties (`d_lths`, `d_hs`, `d_somecol`, `d_ba`, `d_grad`). Click a HUD swatch to hide one subcategory.

## Prerequisites

- Node.js 18+ (for Vite)
- The county education archive in this repo: `pipeline/counties_edu.pmtiles` (source-layer `counties`, zooms 4–10)

Vite serves static files from `demo/public/`, and `*.pmtiles` there is gitignored, so copy (or symlink) the pipeline file into that folder.

## Setup

From the **repository root**:

```bash
npm install
mkdir -p demo/public
cp pipeline/counties_edu.pmtiles demo/public/counties_edu.pmtiles
npm run dev
```

Vite serves `demo/` at [http://localhost:5173](http://localhost:5173). The layer loads `/counties_edu.pmtiles` from `demo/public/`.

If the map is empty, check the network tab for that file (404) and that the archive’s layer name is `counties`.
