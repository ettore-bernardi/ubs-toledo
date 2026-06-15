// Gera data/cobertura.json: para cada bairro, atribui a UBS geocodificada mais próxima
// do centroide do bairro (distância haversine). Arquivo editável à mão depois.
// Usa apenas unidades com lat/lng válidas; o ponto da UBS é a 1ª unidade com coords.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(__dirname, "..", "data");
const bairros = JSON.parse(readFileSync(resolve(dataDir, "bairros.geojson"), "utf8"));
const ubs = JSON.parse(readFileSync(resolve(dataDir, "ubs.json"), "utf8"));

// Ponto representativo de cada UBS = primeira unidade com coordenadas válidas.
const pontosUbs = ubs
  .map((u) => {
    const un = u.unidades.find((x) => x.lat != null && x.lng != null);
    return un ? { id: u.id, nome: u.nome, lat: un.lat, lng: un.lng } : null;
  })
  .filter(Boolean);

// Centroide simples = média dos vértices de todos os anéis externos do polígono.
function centroide(geometry) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  const walk = (c) => {
    if (typeof c[0] === "number") {
      sx += c[0];
      sy += c[1];
      n++;
    } else c.forEach(walk);
  };
  walk(geometry.coordinates);
  return [sx / n, sy / n]; // [lng, lat]
}

const R = 6371; // km
const rad = (d) => (d * Math.PI) / 180;
function haversine(lng1, lat1, lng2, lat2) {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const cobertura = {};
for (const f of bairros.features) {
  const [clng, clat] = centroide(f.geometry);
  let melhor = null;
  for (const p of pontosUbs) {
    const d = haversine(clng, clat, p.lng, p.lat);
    if (!melhor || d < melhor.d) melhor = { id: p.id, nome: p.nome, d };
  }
  cobertura[f.properties.nm_bairro] = melhor.id;
  console.log(
    `${f.properties.nm_bairro.padEnd(22)} -> #${melhor.id} ${melhor.nome} (${melhor.d.toFixed(2)} km)`
  );
}

writeFileSync(resolve(dataDir, "cobertura.json"), JSON.stringify(cobertura, null, 2));
console.log(`\nOK ${Object.keys(cobertura).length} bairros -> data/cobertura.json`);
