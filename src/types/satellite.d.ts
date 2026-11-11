export type SatelliteType = "iss" | "starlink";

export interface Tle {
  line1: string;
  line2: string;
}

/** Entrada de public/data/satellites.json (gerado por scripts/update-data.mjs). */
export interface Satellite {
  id: number;
  name: string;
  type: SatelliteType;
  tle: Tle | null;
  ephemeris: { path: string; start: string; stop: string } | null;
}

export interface SatelliteIndex {
  generatedAt: string;
  satellites: Satellite[];
  groups?: GroupInfo[];
}

/** Grupo opcional do CelesTrak (ver GROUPS em scripts/update-data.mjs). */
export interface GroupInfo {
  key: string;
  label: string;
  category: string;
  count: number;
  path: string;
}

/**
 * Elementos orbitais de um satélite: TLE (line1/line2) ou, para números NORAD
 * de 6 dígitos que não cabem em TLE, OMM no formato JSON do CelesTrak.
 */
export interface SatSource {
  id: number;
  name: string;
  line1?: string;
  line2?: string;
  omm?: Record<string, unknown>;
}

/** Conteúdo de public/data/groups/<grupo>.json. */
export interface GroupData {
  key: string;
  satellites: SatSource[];
}

/** Conteúdo de public/data/starlink/<norad>.json. */
export interface Ephemeris {
  noradId: number;
  name: string;
  frame: "J2000";
  units: "km";
  start: string;
  stop: string;
  /** Passo em segundos entre amostras. */
  step: number;
  /** Offsets em segundos a partir de `start`; ausente quando o passo é regular. */
  times?: number[];
  /** x, y, z (km) achatados: [x0, y0, z0, x1, y1, z1, ...]. */
  positions: number[];
}
