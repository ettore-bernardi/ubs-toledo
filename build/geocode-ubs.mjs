// Geocodifica cada unidade de info.json via Nominatim (OpenStreetMap).
// Respeita a política de uso: User-Agent próprio + 1 requisição por segundo.
// Saída: data/ubs.json = info.json + { lat, lng, geocode_confianca } por unidade.
// Endereços que falham ficam lat/lng=null para ajuste manual posterior.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "..", "info.json");
const OUT = resolve(__dirname, "..", "data", "ubs.json");

const UA = "UBS-Toledo-App/1.0 (cidadao de Toledo/PR; geocode one-time build)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Normaliza o endereço e devolve variantes da mais específica à mais genérica.
// Nominatim costuma falhar quando o sufixo " - Bairro" ou "S/N" entra na busca.
const variantes = (e) => {
  const base = e
    .replace(/–/g, "-")
    .replace(/,?\s*s\/n\b/gi, "")
    .replace(/\besquina com.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  // "Rua X, 147 - Jd. Panorama" -> rua+numero e, separadamente, só a rua.
  const semBairro = base.split(/\s+-\s+/)[0].trim();
  const semNumero = semBairro.replace(/,\s*\d+.*$/, "").trim();
  return [...new Set([base, semBairro, semNumero])].filter(Boolean);
};

// Bounding box de Toledo/PR (lng_min,lat_min,lng_max,lat_max) p/ priorizar resultados.
const VIEWBOX = "-53.95,-24.45,-53.55,-24.95";

async function consulta(q, bounded) {
  const params = {
    format: "json",
    countrycodes: "br",
    limit: "1",
    viewbox: VIEWBOX,
    bounded: bounded ? "1" : "0",
  };
  // Busca estruturada (street/city) resolve melhor "rua, número" que a busca livre.
  if (typeof q === "object") {
    params.street = q.street;
    params.city = "Toledo";
    params.state = "Paraná";
  } else {
    params.q = `${q}, Toledo, PR, Brasil`;
  }
  const url =
    "https://nominatim.openstreetmap.org/search?" + new URLSearchParams(params);
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.length) return null;
  const { lat, lon, importance } = data[0];
  // Descarta resultados fora da região (sanity check do bbox de Toledo).
  const la = Number(lat);
  const lo = Number(lon);
  if (la > -24.45 || la < -24.95 || lo > -53.55 || lo < -53.95) return null;
  return {
    lat: Number(la.toFixed(6)),
    lng: Number(lo.toFixed(6)),
    importance: importance ?? null,
  };
}

async function geocode(endereco) {
  const vs = variantes(endereco);
  // Busca livre (variantes) + busca estruturada por rua, restrito e depois livre.
  const tentativas = [
    ...vs.map((q) => [q, true]),
    [{ street: vs[vs.length - 1] }, true],
    ...vs.map((q) => [q, false]),
    [{ street: vs[vs.length - 1] }, false],
  ];
  for (const [q, bounded] of tentativas) {
    const r = await consulta(q, bounded);
    await sleep(1100); // 1 req/s com folga
    if (r) return r;
  }
  return null;
}

const ubs = JSON.parse(readFileSync(SRC, "utf8"));
let ok = 0;
let falhou = 0;

for (const u of ubs) {
  for (const unidade of u.unidades) {
    try {
      const r = await geocode(unidade.endereco);
      if (r) {
        unidade.lat = r.lat;
        unidade.lng = r.lng;
        unidade.geocode_confianca = r.importance > 0.4 ? "alta" : "media";
        ok++;
        console.log(`OK   ${unidade.nome} -> ${r.lat},${r.lng}`);
      } else {
        unidade.lat = null;
        unidade.lng = null;
        unidade.geocode_confianca = "falhou";
        falhou++;
        console.log(`FALHOU ${unidade.nome} (${unidade.endereco})`);
      }
    } catch (err) {
      unidade.lat = null;
      unidade.lng = null;
      unidade.geocode_confianca = "erro";
      falhou++;
      console.log(`ERRO ${unidade.nome}: ${err.message}`);
    }
  }
}

writeFileSync(OUT, JSON.stringify(ubs, null, 2));
console.log(`\nConcluído: ${ok} geocodificadas, ${falhou} sem coords -> ${OUT}`);
