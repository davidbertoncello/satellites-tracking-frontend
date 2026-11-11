import * as sat from "satellite.js";
import type { SatSource } from "@/types/satellite";

export type OrbitClass = "LEO" | "MEO" | "GEO" | "HEO";

export const ORBIT_CLASSES: Record<OrbitClass, { label: string; hint: string; color: string }> = {
  LEO: { label: "Órbita baixa (LEO)", hint: "período < 128 min, até ~2.000 km", color: "#4fd1ff" },
  MEO: { label: "Órbita média (MEO)", hint: "entre LEO e GEO, ex.: GPS a ~20.000 km", color: "#ffd84f" },
  GEO: { label: "Geossíncrona (GEO)", hint: "período de ~1 dia, a ~35.786 km", color: "#ff6bd6" },
  HEO: { label: "Elíptica (HEO)", hint: "excentricidade > 0,25, ex.: Molniya", color: "#ff9f43" },
};

const EARTH_RADIUS_KM = 6378.135; // WGS-72, o mesmo do SGP4
const RAD = Math.PI / 180;

export function classifyOrbit(meanMotionRevPerDay: number, eccentricity: number): OrbitClass {
  const periodMin = 1440 / meanMotionRevPerDay;
  if (eccentricity > 0.25) return "HEO";
  if (periodMin < 128) return "LEO";
  if (Math.abs(periodMin - 1436) < 60) return "GEO";
  return "MEO";
}

/** Movimento médio (voltas/dia) e excentricidade, lidos direto do TLE/OMM. */
export function elementsOf(s: SatSource): { meanMotion: number; eccentricity: number } | null {
  if (s.omm) {
    return { meanMotion: Number(s.omm.MEAN_MOTION), eccentricity: Number(s.omm.ECCENTRICITY) };
  }
  if (s.line2) {
    return {
      meanMotion: Number(s.line2.slice(52, 63)),
      eccentricity: Number("0." + s.line2.slice(26, 33).trim()),
    };
  }
  return null;
}

export function orbitClassOf(s: SatSource): OrbitClass {
  const els = elementsOf(s);
  return els && els.meanMotion > 0 ? classifyOrbit(els.meanMotion, els.eccentricity) : "LEO";
}

export function makeSatrec(s: SatSource): sat.SatRec | null {
  try {
    if (s.omm) return sat.json2satrec(s.omm as unknown as sat.OMMJsonObject);
    if (s.line1 && s.line2) return sat.twoline2satrec(s.line1, s.line2);
  } catch {
    // TLE/OMM inválido: o satélite simplesmente não aparece.
  }
  return null;
}

/** Posição no referencial fixo à Terra (km), ou null se o SGP4 falhar (ex.: já reentrou). */
export function ecfKm(satrec: sat.SatRec, date: Date): sat.EcfVec3<number> | null {
  try {
    const pv = sat.propagate(satrec, date);
    if (!pv?.position) return null;
    return sat.eciToEcf(pv.position, sat.gstime(date));
  } catch {
    return null;
  }
}

export interface OrbitDetails {
  latitude: number;
  longitude: number;
  altitudeKm: number;
  speedKmS: number;
  periodMin: number;
  inclinationDeg: number;
  perigeeKm: number;
  apogeeKm: number;
  /** Instante (ms) dos elementos orbitais usados. */
  epochMs: number;
}

export function orbitDetails(satrec: sat.SatRec, date: Date): OrbitDetails | null {
  try {
    const pv = sat.propagate(satrec, date);
    if (!pv?.position || !pv.velocity) return null;
    const gd = sat.eciToGeodetic(pv.position, sat.gstime(date));
    const v = pv.velocity;
    return {
      latitude: sat.degreesLat(gd.latitude),
      longitude: sat.degreesLong(gd.longitude),
      altitudeKm: gd.height,
      speedKmS: Math.hypot(v.x, v.y, v.z),
      periodMin: (2 * Math.PI) / satrec.no,
      inclinationDeg: satrec.inclo / RAD,
      perigeeKm: satrec.altp * EARTH_RADIUS_KM,
      apogeeKm: satrec.alta * EARTH_RADIUS_KM,
      epochMs: (satrec.jdsatepoch - 2440587.5) * 86_400_000,
    };
  } catch {
    return null;
  }
}

/** Período orbital em ms (limitado a 1 dia, para desenhar a trajetória). */
export function periodMs(satrec: sat.SatRec): number {
  return Math.min(((2 * Math.PI) / satrec.no) * 60_000, 86_400_000);
}
