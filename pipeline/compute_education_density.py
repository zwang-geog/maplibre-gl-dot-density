# %%
from pathlib import Path

import geopandas as gpd
import pandas as pd
from pyproj import Geod

# TIGER 2025 counties (NAD83). These polygons include water; dots will fall
# on water in proportion to that extra area. Cartographic boundary files would
# match drawn land more closely.
source = Path(
    "/Users/zifanwang/Library/Mobile Documents/com~apple~CloudDocs/"
    "pie-charts/tl_2025_us_county/tl_2025_us_county.shp"
)
edu_source = Path(
    "/Users/zifanwang/Library/Mobile Documents/com~apple~CloudDocs/"
    "pie-charts/ACSDT5Y2024.B15003_2026-11-15T200607/"
    "ACSDT5Y2024.B15003-Data.csv"
)
output_dir = Path(
    "/Users/zifanwang/Library/Mobile Documents/com~apple~CloudDocs/"
    "pie-charts/dot-density"
)
output_dir.mkdir(parents=True, exist_ok=True)

# ACS B15003 is educational attainment for the population 25 years and over,
# not total population. Five groups match docs/design_2.md.
COUNT_COLUMNS = [
    "below_hs",
    "high_school",
    "some_college",
    "bachelors",
    "graduate",
]
DENSITY_COLUMNS = [
    "d_lths",
    "d_hs",
    "d_somecol",
    "d_ba",
    "d_grad",
]

# %%
frame = gpd.read_file(source)
# The description row sits under the variable codes. GEO_ID ends in the county GEOID.
estimates = pd.read_csv(edu_source, encoding="utf-8-sig", skiprows=[1])
estimates["GEOID"] = estimates["GEO_ID"].str[-5:]
codes = [f"B15003_{number:03d}E" for number in range(2, 26)]
values = estimates[codes].apply(pd.to_numeric, errors="coerce")
education = pd.DataFrame({
    "GEOID": estimates["GEOID"],
    "below_hs": values.iloc[:, 0:15].sum(axis=1, min_count=1),
    "high_school": values.iloc[:, 15:17].sum(axis=1, min_count=1),
    "some_college": values.iloc[:, 17:20].sum(axis=1, min_count=1),
    "bachelors": values.iloc[:, 20:21].sum(axis=1, min_count=1),
    "graduate": values.iloc[:, 21:24].sum(axis=1, min_count=1),
})
frame["GEOID"] = frame["GEOID"].astype(str).str.zfill(5)
frame = frame.merge(education, on="GEOID", how="left")

# %%
# Geodesic area on WGS84, so Alaska, Hawaii, and Puerto Rico stay correct.
# EPSG:5070 is only equal-area for the conterminous US.
geod = Geod(ellps="WGS84")
wgs84 = frame.to_crs("EPSG:4326")


def geodesic_area_m2(geom) -> float:
    if geom is None or geom.is_empty:
        return 0.0
    if geom.geom_type == "MultiPolygon":
        return float(sum(abs(geod.geometry_area_perimeter(part)[0]) for part in geom.geoms))
    return float(abs(geod.geometry_area_perimeter(geom)[0]))


wgs84["area_km2"] = wgs84.geometry.map(geodesic_area_m2) / 1_000_000.0
# Census land area, for a QA comparison only. Do not use it as the density
# denominator: the polygons we draw are larger than ALAND wherever they
# include water.
if "ALAND" in wgs84.columns:
    wgs84["aland_km2"] = pd.to_numeric(wgs84["ALAND"], errors="coerce") / 1_000_000.0

area = wgs84["area_km2"].where(wgs84["area_km2"] > 0)
for count_name, density_name in zip(COUNT_COLUMNS, DENSITY_COLUMNS):
    wgs84[density_name] = wgs84[count_name] / area

# %%
print(wgs84[COUNT_COLUMNS + DENSITY_COLUMNS + ["area_km2"]].describe())
print("rows with no ACS match:", int(wgs84["below_hs"].isna().sum()))
print("rows with zero area:", int((wgs84["area_km2"] <= 0).sum()))
if "aland_km2" in wgs84.columns:
    ratio = wgs84["area_km2"] / wgs84["aland_km2"].replace(0, pd.NA)
    print("geometry area / ALAND, median:", float(ratio.median()))

# %%
export = wgs84[["GEOID", *DENSITY_COLUMNS, "geometry"]].copy()
export = export.dropna(subset=DENSITY_COLUMNS, how="all")

geojson_path = output_dir / "counties_edu_density.geojson"
parquet_path = output_dir / "counties_edu_density.parquet"
export.to_file(geojson_path, driver="GeoJSON")
export.to_parquet(parquet_path, index=False)
print("wrote", geojson_path)
print("wrote", parquet_path)

# Counties are coarse enough that z4–z10 is plenty. Check flags against the
# current tippecanoe docs before running.
print(
    "tippecanoe -o "
    f'"{output_dir / "counties_edu.pmtiles"}" '
    "-l counties -Z4 -z10 "
    "--no-feature-limit --no-tile-size-limit "
    "--no-tiny-polygon-reduction --detect-shared-borders "
    "-y GEOID -y d_lths -y d_hs -y d_somecol -y d_ba -y d_grad "
    f'"{geojson_path}"'
)
