/**
 * Web Mercator lon/lat → OSM tile index.
 *
 * Adapted from @mapbox/tilebelt
 * https://github.com/mapbox/tilebelt
 * Copyright (c) 2014 Morgan Herlocker
 * Licensed under the MIT License (see LICENSE).
 */

const DEG_TO_RAD = Math.PI / 180;

/** Fractional tile coordinates at zoom `z`. */
export function pointToTileFraction(lon: number, lat: number, z: number): [number, number, number] {
  const sin = Math.sin(lat * DEG_TO_RAD);
  const z2 = 2 ** z;
  let x = z2 * (lon / 360 + 0.5);
  const y = z2 * (0.5 - (0.25 * Math.log((1 + sin) / (1 - sin))) / Math.PI);
  x = x % z2;
  if (x < 0) x += z2;
  return [x, y, z];
}

/** Integer tile containing a lon/lat at zoom `z`. */
export function pointToTile(lon: number, lat: number, z: number): [number, number, number] {
  const tile = pointToTileFraction(lon, lat, z);
  return [Math.floor(tile[0]), Math.floor(tile[1]), z];
}
