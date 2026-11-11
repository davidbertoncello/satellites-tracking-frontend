/**
 * Propaga (SGP4) a lista inteira de satélites dos grupos ligados, fora da
 * thread principal. Devolve `count` amostras espaçadas de `step` ms a partir
 * de `t0`, em metros no referencial fixo à Terra, achatadas como
 * [amostra][satélite][x, y, z]. NaN marca quem não pôde ser propagado.
 */
import * as sat from "satellite.js";
import { makeSatrec } from "@/lib/orbit";
import type { SatSource } from "@/types/satellite";

export type PropagatorMessage =
  | { type: "set"; gen: number; sats: SatSource[] }
  | { type: "compute"; gen: number; reqId: number; t0: number; step: number; count: number };

let gen = -1;
let satrecs: (sat.SatRec | null)[] = [];

self.onmessage = (ev: MessageEvent<PropagatorMessage>) => {
  const m = ev.data;
  if (m.type === "set") {
    gen = m.gen;
    satrecs = m.sats.map(makeSatrec);
    return;
  }
  if (m.gen !== gen) return;

  const n = satrecs.length;
  const data = new Float32Array(n * m.count * 3);
  for (let k = 0; k < m.count; k++) {
    const date = new Date(m.t0 + k * m.step);
    const gmst = sat.gstime(date);
    for (let i = 0; i < n; i++) {
      const base = (k * n + i) * 3;
      const satrec = satrecs[i];
      let pos: sat.EciVec3<number> | null = null;
      if (satrec) {
        try {
          pos = sat.propagate(satrec, date)?.position ?? null;
        } catch {
          pos = null;
        }
      }
      if (!pos) {
        data[base] = data[base + 1] = data[base + 2] = NaN;
        continue;
      }
      const ecf = sat.eciToEcf(pos, gmst);
      data[base] = ecf.x * 1000;
      data[base + 1] = ecf.y * 1000;
      data[base + 2] = ecf.z * 1000;
    }
  }
  self.postMessage(
    { gen, reqId: m.reqId, t0: m.t0, step: m.step, count: m.count, data },
    { transfer: [data.buffer] },
  );
};
