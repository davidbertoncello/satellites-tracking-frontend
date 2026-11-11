/**
 * Previsão de passagens sobre um observador, em JS puro (roda em Web Worker).
 *
 * Varre o intervalo em passos de 30 s, refina nascer/ocaso por bisseção e a
 * elevação máxima por busca ternária. Uma passagem é "visível" a olho nu se,
 * em algum momento, o satélite está iluminado pelo Sol enquanto o observador
 * está no escuro (Sol abaixo de -6°, crepúsculo civil).
 */
import * as sat from "satellite.js";

export interface Observer {
  /** Graus. */
  lat: number;
  lon: number;
  heightKm?: number;
}

export interface Pass {
  id: number;
  name: string;
  start: number;
  end: number;
  maxTime: number;
  maxElevation: number;
  startAzimuth: number;
  endAzimuth: number;
  visible: boolean;
  /** Já estava acima do horizonte no início do intervalo. */
  inProgress: boolean;
  /** Acima do horizonte o intervalo inteiro (típico de GEO). */
  continuous: boolean;
}

export interface PassOptions {
  minElevation?: number;
  stepSec?: number;
  onlyVisible?: boolean;
}

const RAD = Math.PI / 180;
const AU_KM = 149_597_870.7;
const EARTH_RADIUS_KM = 6371;
const TWILIGHT_DEG = -6;

function observerGd(o: Observer): sat.GeodeticLocation {
  return { latitude: o.lat * RAD, longitude: o.lon * RAD, height: o.heightKm ?? 0 };
}

function look(satrec: sat.SatRec, gd: sat.GeodeticLocation, ms: number) {
  const date = new Date(ms);
  try {
    const pv = sat.propagate(satrec, date);
    if (!pv?.position) return null;
    const gmst = sat.gstime(date);
    const la = sat.ecfToLookAngles(gd, sat.eciToEcf(pv.position, gmst));
    return { elevation: la.elevation / RAD, azimuth: la.azimuth / RAD, eci: pv.position, gmst };
  } catch {
    return null;
  }
}

function sunEciKm(date: Date) {
  const { rsun } = sat.sunPos(sat.jday(date));
  return { x: rsun[0] * AU_KM, y: rsun[1] * AU_KM, z: rsun[2] * AU_KM };
}

/** Sombra cilíndrica da Terra: boa o bastante para dizer se o satélite brilha. */
function isSunlit(satEci: sat.EciVec3<number>, sun: sat.EciVec3<number>): boolean {
  const len = Math.hypot(sun.x, sun.y, sun.z);
  const ux = sun.x / len, uy = sun.y / len, uz = sun.z / len;
  const proj = satEci.x * ux + satEci.y * uy + satEci.z * uz;
  if (proj > 0) return true;
  const px = satEci.x - proj * ux, py = satEci.y - proj * uy, pz = satEci.z - proj * uz;
  return Math.hypot(px, py, pz) > EARTH_RADIUS_KM;
}

/** Elevação do Sol (graus) para o observador. */
export function sunElevation(observer: Observer, ms: number): number {
  const date = new Date(ms);
  const sunEcf = sat.eciToEcf(sunEciKm(date), sat.gstime(date));
  return sat.ecfToLookAngles(observerGd(observer), sunEcf).elevation / RAD;
}

export function computePasses(
  src: { id: number; name: string },
  satrec: sat.SatRec,
  observer: Observer,
  fromMs: number,
  toMs: number,
  { minElevation = 10, stepSec = 30, onlyVisible = false }: PassOptions = {},
): Pass[] {
  const gd = observerGd(observer);
  const step = stepSec * 1000;
  const el = (ms: number) => look(satrec, gd, ms)?.elevation ?? -90;
  const passes: Pass[] = [];

  const crossing = (lo: number, hi: number, rising: boolean) => {
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      if ((el(mid) >= minElevation) === rising) hi = mid;
      else lo = mid;
    }
    return (lo + hi) / 2;
  };

  const finish = (rise: number, set: number, roughMax: number) => {
    // Elevação máxima: busca ternária em volta da melhor amostra.
    let lo = Math.max(rise, roughMax - step);
    let hi = Math.min(set, roughMax + step);
    for (let i = 0; i < 25; i++) {
      const m1 = lo + (hi - lo) / 3;
      const m2 = hi - (hi - lo) / 3;
      if (el(m1) < el(m2)) lo = m1;
      else hi = m2;
    }
    const maxTime = (lo + hi) / 2;

    let visible = false;
    const sampleStep = Math.max(10_000, (set - rise) / 200);
    for (let t = rise; t <= set && !visible; t += sampleStep) {
      const l = look(satrec, gd, t);
      if (!l) continue;
      const date = new Date(t);
      const sun = sunEciKm(date);
      const sunEl = sat.ecfToLookAngles(gd, sat.eciToEcf(sun, l.gmst)).elevation / RAD;
      visible = sunEl < TWILIGHT_DEG && isSunlit(l.eci, sun);
    }
    if (onlyVisible && !visible) return;

    passes.push({
      id: src.id,
      name: src.name,
      start: rise,
      end: set,
      maxTime,
      maxElevation: el(maxTime),
      startAzimuth: look(satrec, gd, rise)?.azimuth ?? 0,
      endAzimuth: look(satrec, gd, set)?.azimuth ?? 0,
      visible,
      inProgress: rise === fromMs,
      continuous: rise === fromMs && set === toMs,
    });
  };

  let prevT = fromMs;
  let riseT: number | null = el(fromMs) >= minElevation ? fromMs : null;
  let maxT = fromMs;
  let maxEl = riseT !== null ? el(fromMs) : -90;

  for (let t = fromMs + step; prevT < toMs; t += step) {
    const tt = Math.min(t, toMs);
    const e = el(tt);
    if (riseT === null && e >= minElevation) {
      riseT = crossing(prevT, tt, true);
      maxT = tt;
      maxEl = e;
    } else if (riseT !== null) {
      if (e > maxEl) {
        maxEl = e;
        maxT = tt;
      }
      if (e < minElevation) {
        finish(riseT, crossing(prevT, tt, false), maxT);
        riseT = null;
      }
    }
    prevT = tt;
    // Bem abaixo do horizonte não há passagem nos próximos minutos: pula 2 passos.
    if (riseT === null && e < -45) {
      t += 2 * step;
      prevT = Math.min(t, toMs);
    }
  }
  if (riseT !== null) finish(riseT, toMs, maxT);
  return passes;
}
