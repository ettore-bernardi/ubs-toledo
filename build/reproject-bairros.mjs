// Reprojeta bairros.geojson de EPSG:31982 (SIRGAS 2000 / UTM 22S) para WGS84 (EPSG:4326).
// Conversão 100% local com proj4 — não depende da WFS do município.
// Saída intermediária: build/bairros-wgs84.geojson (simplificada depois com mapshaper).
import proj4 from "proj4";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "..", "bairros.geojson");
const OUT = resolve(__dirname, "bairros-wgs84.geojson");

const UTM22S =
  "+proj=utm +zone=22 +south +ellps=GRS80 +towgs84=0,0,0 +units=m +no_defs";
const WGS84 = "+proj=longlat +datum=WGS84 +no_defs";

const toWGS84 = ([x, y]) => {
  const [lng, lat] = proj4(UTM22S, WGS84, [x, y]);
  return [Number(lng.toFixed(6)), Number(lat.toFixed(6))];
};

// Aplica recursivamente a transformação em qualquer profundidade de coordenadas.
const transform = (coords) =>
  typeof coords[0] === "number" ? toWGS84(coords) : coords.map(transform);

const geo = JSON.parse(readFileSync(SRC, "utf8"));
let min = [Infinity, Infinity];
let max = [-Infinity, -Infinity];

for (const f of geo.features) {
  f.geometry.coordinates = transform(f.geometry.coordinates);
  // Acompanha o bounding box para validação visual rápida.
  const scan = (c) => {
    if (typeof c[0] === "number") {
      min = [Math.min(min[0], c[0]), Math.min(min[1], c[1])];
      max = [Math.max(max[0], c[0]), Math.max(max[1], c[1])];
    } else c.forEach(scan);
  };
  scan(f.geometry.coordinates);
}

// CRS agora é WGS84 — remove o tag de CRS UTM (4326 é o default do GeoJSON).
delete geo.crs;

writeFileSync(OUT, JSON.stringify(geo));
console.log(`OK ${geo.features.length} bairros -> ${OUT}`);
console.log(`bbox lng [${min[0]}, ${max[0]}]  lat [${min[1]}, ${max[1]}]`);
console.log("Esperado: lng ~ -53.7, lat ~ -24.7 (Toledo/PR)");
