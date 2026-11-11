#!/usr/bin/env node
/**
 * Atualiza os dados estáticos de satélites em public/data/.
 *
 *   npm run update-data
 *   STARLINK_COUNT=40 npm run update-data
 *
 * Fontes:
 *   - TLEs (ISS e Starlink): CelesTrak (https://celestrak.org)
 *   - Efemérides Starlink (72 h, passo de 60 s, referencial J2000/MEME):
 *     https://api.starlink.com/public-files/ephemerides/
 *
 * Saída:
 *   public/data/satellites.json        índice carregado pelo frontend
 *   public/data/starlink/<norad>.json  amostras de posição por satélite
 *   public/data/groups/<grupo>.json    TLEs de cada grupo do CelesTrak (GROUPS)
 *
 * Rodar uma vez por dia: as efemérides cobrem no máximo 72 h (algumas só
 * 48 h) e já começam algumas horas antes do download. Depois que vencem, o
 * frontend usa o TLE, que perde precisão rápido.
 *
 * Os arquivos são gerados numa pasta temporária e trocados no final, então o
 * frontend nunca vê um conjunto pela metade se o script falhar no meio.
 */
import { mkdir, readFile, rm, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, "public", "data");
const TMP_DIR = join(ROOT, "public", "data.tmp");
const OLD_DIR = join(ROOT, "public", "data.old");
const CACHE_DIR = join(ROOT, "scripts", ".cache");

const STARLINK_COUNT = Number(process.env.STARLINK_COUNT ?? 20);
const CONCURRENCY = 4;
const ISS_NORAD_ID = 25544;

const EPHEMERIS_BASE = "https://api.starlink.com/public-files/ephemerides";
const CELESTRAK_GP = "https://celestrak.org/NORAD/elements/gp.php";
const USER_AGENT = "satellite-tracking-data-updater";

/**
 * Grupos opcionais que o usuário liga/desliga no mapa. `query` é a consulta
 * do gp.php do CelesTrak; `catnr` monta um grupo próprio a partir de números
 * NORAD avulsos. Um grupo que falhar é pulado (com aviso), sem derrubar o resto.
 */
const GROUPS = [
  { key: "stations", label: "Estações e naves tripuladas", category: "Estações", query: "GROUP=stations" },
  { key: "visual", label: "Mais brilhantes (olho nu)", category: "Visíveis a olho nu", query: "GROUP=visual" },
  { key: "starlink", label: "Starlink (todos)", category: "Megaconstelações", reuse: "starlink" },
  { key: "oneweb", label: "OneWeb", category: "Megaconstelações", query: "GROUP=oneweb" },
  { key: "kuiper", label: "Amazon Kuiper", category: "Megaconstelações", query: "GROUP=kuiper" },
  { key: "qianfan", label: "Qianfan (China)", category: "Megaconstelações", query: "GROUP=qianfan" },
  { key: "gps-ops", label: "GPS", category: "Navegação (GNSS)", query: "GROUP=gps-ops" },
  { key: "glo-ops", label: "GLONASS", category: "Navegação (GNSS)", query: "GROUP=glo-ops" },
  { key: "galileo", label: "Galileo", category: "Navegação (GNSS)", query: "GROUP=galileo" },
  { key: "beidou", label: "BeiDou", category: "Navegação (GNSS)", query: "GROUP=beidou" },
  { key: "weather", label: "Meteorológicos", category: "Clima e observação da Terra", query: "GROUP=weather" },
  { key: "resource", label: "Observação da Terra", category: "Clima e observação da Terra", query: "GROUP=resource" },
  {
    key: "brasil",
    label: "Satélites brasileiros",
    category: "Clima e observação da Terra",
    // CBERS-4, CBERS-4A, Amazonia-1, SCD-1, SCD-2, SGDC-1
    catnr: [40336, 44883, 47699, 22490, 25504, 42692],
  },
  { key: "geo", label: "Geoestacionários", category: "Comunicações", query: "GROUP=geo" },
  { key: "science", label: "Científicos", category: "Ciência e radioamador", query: "GROUP=science" },
  { key: "amateur", label: "Radioamador", category: "Ciência e radioamador", query: "GROUP=amateur" },
  { key: "cubesat", label: "CubeSats", category: "Ciência e radioamador", query: "GROUP=cubesat" },
  // Objetos novos já têm número NORAD de 6 dígitos, que não cabe em TLE: usa OMM (JSON).
  { key: "last-30-days", label: "Lançados nos últimos 30 dias", category: "Eventos", query: "GROUP=last-30-days", omm: true },
  { key: "cosmos-2251-debris", label: "Detritos Cosmos 2251 (colisão 2009)", category: "Detritos", query: "GROUP=cosmos-2251-debris" },
  { key: "iridium-33-debris", label: "Detritos Iridium 33 (colisão 2009)", category: "Detritos", query: "GROUP=iridium-33-debris" },
  { key: "fengyun-1c-debris", label: "Detritos Fengyun-1C (teste ASAT 2007)", category: "Detritos", query: "GROUP=fengyun-1c-debris" },
  { key: "cosmos-1408-debris", label: "Detritos Cosmos 1408 (teste ASAT 2021)", category: "Detritos", query: "GROUP=cosmos-1408-debris" },
];

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.text();
}

/**
 * O CelesTrak responde 403 se o mesmo conjunto for baixado de novo antes da
 * próxima atualização dele (a cada 2 h). Guardamos a última resposta em
 * scripts/.cache e reaproveitamos nesse caso.
 */
async function fetchCelestrak(query, cacheName) {
  const cachePath = join(CACHE_DIR, cacheName);
  const res = await fetch(`${CELESTRAK_GP}?${query}`, { headers: { "User-Agent": USER_AGENT } });
  const body = await res.text();
  if (res.ok) {
    if (!/^1 /m.test(body) && !/^\s*\[\s*\{/.test(body)) {
      throw new Error(`CelesTrak ${query} sem TLEs: ${body.trim().slice(0, 200)}`);
    }
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cachePath, body);
    return body;
  }
  if (res.status === 403 && /has not updated/i.test(body) && existsSync(cachePath)) {
    console.log(`  CelesTrak sem dados novos para ${query}, usando cache`);
    return readFile(cachePath, "utf8");
  }
  throw new Error(`HTTP ${res.status} em CelesTrak ${query}: ${body.trim().slice(0, 200)}`);
}

/** Lê um arquivo TLE (3 linhas por satélite) e indexa por número NORAD. */
function parseTleFile(text) {
  const lines = text.replace(/\r/g, "").split("\n").map((l) => l.trimEnd());
  const byId = new Map();
  for (let i = 0; i + 2 < lines.length; i++) {
    if (lines[i + 1].startsWith("1 ") && lines[i + 2].startsWith("2 ")) {
      const id = Number(lines[i + 1].slice(2, 7));
      byId.set(id, { name: lines[i].trim(), line1: lines[i + 1], line2: lines[i + 2] });
      i += 2;
    }
  }
  return byId;
}

/** MEME_<norad>_<nome>_<id>_<status>_<...>.txt */
function parseManifestLine(file) {
  const [, norad, name, , status] = file.split("_");
  return { file, noradId: Number(norad), name, status };
}

/** "2026310095642.000" (AAAADDDHHMMSS.sss, UTC) -> epoch em ms */
function parseEphemerisTime(s) {
  const year = Number(s.slice(0, 4));
  const doy = Number(s.slice(4, 7));
  const h = Number(s.slice(7, 9));
  const m = Number(s.slice(9, 11));
  const sec = Number(s.slice(11));
  return Date.UTC(year, 0, doy, h, m, 0) + sec * 1000;
}

/**
 * Formato SpaceX: 4 linhas de cabeçalho e, depois, blocos de 4 linhas por
 * instante: "tempo x y z vx vy vz" (km, km/s) + 3 linhas de covariância
 * (ignoradas aqui).
 */
function parseEphemeris(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  const header = lines.slice(0, 4).join(" ");
  const frame = lines[3].trim(); // referencial da covariância (UVW)
  const created = header.match(/created:(\S+ \S+) UTC/)?.[1];

  const times = [];
  const positions = [];
  for (let i = 4; i < lines.length; i += 4) {
    const parts = lines[i].trim().split(/\s+/);
    if (parts.length < 7) continue;
    times.push(parseEphemerisTime(parts[0]));
    positions.push(
      Number(Number(parts[1]).toFixed(3)),
      Number(Number(parts[2]).toFixed(3)),
      Number(Number(parts[3]).toFixed(3)),
    );
  }
  if (times.length < 2) throw new Error("efeméride sem amostras");

  const step = (times[1] - times[0]) / 1000;
  const regular = times.every((t, k) => k === 0 || t - times[k - 1] === step * 1000);
  return {
    created: created ? new Date(created.replace(" ", "T") + "Z").toISOString() : null,
    covarianceFrame: frame,
    start: new Date(times[0]).toISOString(),
    stop: new Date(times.at(-1)).toISOString(),
    step,
    // Com passo regular, os tempos são implícitos: t_k = start + k * step.
    times: regular ? undefined : times.map((t) => (t - times[0]) / 1000),
    positions,
  };
}

/** Escolhe N satélites espalhados pela lista ordenada (variedade de órbitas). */
function pickSpread(list, n) {
  if (list.length <= n) return list;
  const stride = list.length / n;
  return Array.from({ length: n }, (_, k) => list[Math.floor(k * stride)]);
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    }),
  );
  return results;
}

/** Baixa um grupo de GROUPS; devolve null (com aviso) se falhar. */
async function fetchGroup(group, reused) {
  try {
    let byId;
    if (group.omm) {
      const omms = JSON.parse(await fetchCelestrak(`${group.query}&FORMAT=json`, `${group.key}.json`));
      if (!omms.length) throw new Error("nenhum OMM");
      return omms.map((omm) => ({ id: omm.NORAD_CAT_ID, name: omm.OBJECT_NAME, omm }));
    }
    if (group.reuse) {
      byId = reused[group.reuse];
    } else if (group.catnr) {
      byId = new Map();
      for (const id of group.catnr) {
        const tles = parseTleFile(await fetchCelestrak(`CATNR=${id}&FORMAT=tle`, `catnr-${id}.tle`));
        for (const [k, v] of tles) byId.set(k, v);
      }
    } else {
      byId = parseTleFile(await fetchCelestrak(`${group.query}&FORMAT=tle`, `${group.key}.tle`));
    }
    if (!byId.size) throw new Error("nenhum TLE");
    const satellites = [...byId].map(([id, t]) => ({ id, name: t.name, line1: t.line1, line2: t.line2 }));
    return satellites;
  } catch (err) {
    console.warn(`  ! grupo ${group.key} ignorado: ${err.message}`);
    return null;
  }
}

async function main() {
  console.log("Baixando TLEs do CelesTrak...");
  const [issTle, starlinkTles] = await Promise.all([
    fetchCelestrak(`CATNR=${ISS_NORAD_ID}&FORMAT=tle`, "iss.tle").then(parseTleFile),
    fetchCelestrak("GROUP=starlink&FORMAT=tle", "starlink.tle").then(parseTleFile),
  ]);
  const iss = issTle.get(ISS_NORAD_ID);
  if (!iss) throw new Error("TLE da ISS não encontrado");

  console.log("Baixando manifest de efemérides da SpaceX...");
  const manifest = (await fetchText(`${EPHEMERIS_BASE}/MANIFEST.txt`))
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.endsWith(".txt"))
    .map(parseManifestLine)
    // Só operacionais e com TLE (o TLE é o plano B quando a efeméride vencer).
    .filter((e) => e.status === "Operational" && starlinkTles.has(e.noradId))
    .sort((a, b) => a.noradId - b.noradId);

  const chosen = pickSpread(manifest, STARLINK_COUNT);
  console.log(`${manifest.length} Starlinks disponíveis, baixando ${chosen.length}...`);

  await rm(TMP_DIR, { recursive: true, force: true });
  await mkdir(join(TMP_DIR, "starlink"), { recursive: true });

  const starlinks = await mapLimit(chosen, CONCURRENCY, async (entry) => {
    const eph = parseEphemeris(await fetchText(`${EPHEMERIS_BASE}/${entry.file}`));
    const path = `starlink/${entry.noradId}.json`;
    await writeFile(
      join(TMP_DIR, path),
      JSON.stringify({ noradId: entry.noradId, name: entry.name, frame: "J2000", units: "km", ...eph }),
    );
    const tle = starlinkTles.get(entry.noradId);
    console.log(`  ${entry.name} (${entry.noradId}) ${eph.start} -> ${eph.stop}`);
    return {
      id: entry.noradId,
      name: entry.name,
      type: "starlink",
      tle: { line1: tle.line1, line2: tle.line2 },
      ephemeris: { path, start: eph.start, stop: eph.stop },
    };
  });

  const index = {
    generatedAt: new Date().toISOString(),
    sources: { tle: "celestrak.org", ephemeris: EPHEMERIS_BASE },
    satellites: [
      {
        id: ISS_NORAD_ID,
        name: "ISS",
        type: "iss",
        tle: { line1: iss.line1, line2: iss.line2 },
        ephemeris: null,
      },
      ...starlinks,
    ],
  };
  console.log(`Baixando ${GROUPS.length} grupos do CelesTrak...`);
  await mkdir(join(TMP_DIR, "groups"), { recursive: true });
  const groupResults = await mapLimit(GROUPS, 2, (group) => fetchGroup(group, { starlink: starlinkTles }));
  index.groups = [];
  for (const [i, group] of GROUPS.entries()) {
    const satellites = groupResults[i];
    if (!satellites) continue;
    const path = `groups/${group.key}.json`;
    await writeFile(join(TMP_DIR, path), JSON.stringify({ key: group.key, satellites }));
    index.groups.push({ key: group.key, label: group.label, category: group.category, count: satellites.length, path });
    console.log(`  ${group.key}: ${satellites.length}`);
  }

  await writeFile(join(TMP_DIR, "satellites.json"), JSON.stringify(index, null, 2));

  // Troca data.tmp -> data.
  await rm(OLD_DIR, { recursive: true, force: true });
  if (existsSync(DATA_DIR)) await rename(DATA_DIR, OLD_DIR);
  await rename(TMP_DIR, DATA_DIR);
  await rm(OLD_DIR, { recursive: true, force: true });

  console.log(
    `Pronto: ${index.satellites.length} satélites e ${index.groups.length} grupos em public/data/`,
  );
}

main().catch(async (err) => {
  console.error(err);
  await rm(TMP_DIR, { recursive: true, force: true });
  process.exit(1);
});
