import { computePasses, type Observer, type Pass } from "@/lib/passes";
import { elementsOf, makeSatrec } from "@/lib/orbit";
import type { SatSource } from "@/types/satellite";

export interface PassRequest {
  reqId: number;
  sats: SatSource[];
  observer: Observer;
  fromMs: number;
  toMs: number;
  minElevation?: number;
  onlyVisible?: boolean;
  /** Ignora quem não é de órbita baixa (GEO/MEO não "passam" de verdade). */
  leoOnly?: boolean;
}

self.onmessage = (ev: MessageEvent<PassRequest>) => {
  const { reqId, sats, observer, fromMs, toMs, minElevation, onlyVisible, leoOnly } = ev.data;
  const passes: Pass[] = [];
  for (const s of sats) {
    if (leoOnly) {
      const els = elementsOf(s);
      if (!els || 1440 / els.meanMotion >= 225) continue;
    }
    const satrec = makeSatrec(s);
    if (!satrec) continue;
    passes.push(...computePasses(s, satrec, observer, fromMs, toMs, { minElevation, onlyVisible }));
  }
  passes.sort((a, b) => a.start - b.start);
  self.postMessage({ reqId, passes });
};
