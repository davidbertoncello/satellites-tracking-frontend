/**
 * Desenha milhares de satélites como PointPrimitives (bem mais leve que uma
 * Entity por satélite). O SGP4 roda no propagator.worker, que devolve uma
 * janela de amostras à frente do relógio; a cada quadro só interpolamos
 * linearmente entre duas amostras (passos de até 60 s: erro de poucos km).
 */
import type { SatSource } from "@/types/satellite";
import type { PropagatorMessage } from "@/workers/propagator.worker";

export interface LayerItem {
  id: number;
  name: string;
  groupKey: string;
  groupLabel: string;
  source: SatSource;
  color: string;
}

interface Window {
  t0: number;
  step: number;
  count: number;
  data: Float32Array;
}

/** Orçamento de propagações por pedido ao worker. */
const MAX_PROPAGATIONS = 300_000;

export class GroupPointsLayer {
  items: LayerItem[] = [];
  private points: any;
  private pointList: any[] = [];
  private worker: Worker;
  private gen = 0;
  private reqId = 0;
  private pending = false;
  private win: Window | null = null;
  private lastT = NaN;
  private scratch: any;
  private removeListener: () => void;

  constructor(
    private viewer: any,
    private Cesium: any,
  ) {
    this.points = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
    this.scratch = new Cesium.Cartesian3();
    this.worker = new Worker(new URL("../workers/propagator.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (ev) => this.onResult(ev.data);
    this.removeListener = viewer.scene.preUpdate.addEventListener(() => this.update());
  }

  owns(collection: unknown): boolean {
    return collection === this.points;
  }

  setItems(items: LayerItem[]) {
    const { Cesium } = this;
    this.items = items;
    this.gen++;
    this.win = null;
    this.pending = false;
    this.lastT = NaN;
    this.points.removeAll();

    const pixelSize = items.length > 3000 ? 3 : 4;
    const colors = new Map<string, any>();
    this.pointList = items.map((item, i) => {
      let color = colors.get(item.color);
      if (!color) colors.set(item.color, (color = Cesium.Color.fromCssColorString(item.color)));
      return this.points.add({ id: i, show: false, pixelSize, color, position: Cesium.Cartesian3.ZERO });
    });

    const msg: PropagatorMessage = { type: "set", gen: this.gen, sats: items.map((i) => i.source) };
    this.worker.postMessage(msg);
    this.viewer.scene.requestRender();
  }

  destroy() {
    this.removeListener();
    this.worker.terminate();
    this.viewer.scene.primitives.remove(this.points);
  }

  private update() {
    const n = this.items.length;
    if (!n) return;
    const clock = this.viewer.clock;
    const t = this.Cesium.JulianDate.toDate(clock.currentTime).getTime();
    this.maybeRequest(t, clock.shouldAnimate ? clock.multiplier : 0);

    const w = this.win;
    if (!w || t === this.lastT || w.data.length !== n * w.count * 3) return;
    this.lastT = t;

    const u = (t - w.t0) / w.step;
    const k = Math.min(Math.max(Math.floor(u), 0), w.count - 2);
    // Fora da janela (worker atrasado), extrapola no máximo um passo.
    const f = Math.min(Math.max(u - k, -1), 2);
    const a = k * n * 3;
    const b = (k + 1) * n * 3;
    const d = w.data;
    const p = this.scratch;
    for (let i = 0; i < n; i++) {
      const point = this.pointList[i];
      const ax = d[a + 3 * i];
      const bx = d[b + 3 * i];
      if (Number.isNaN(ax) || Number.isNaN(bx)) {
        point.show = false;
        continue;
      }
      p.x = ax + (bx - ax) * f;
      p.y = d[a + 3 * i + 1] + (d[b + 3 * i + 1] - d[a + 3 * i + 1]) * f;
      p.z = d[a + 3 * i + 2] + (d[b + 3 * i + 2] - d[a + 3 * i + 2]) * f;
      point.position = p;
      point.show = true;
    }
  }

  private maybeRequest(t: number, multiplier: number) {
    if (this.pending) return;
    const dir = multiplier < 0 ? -1 : 1;
    const w = this.win;
    if (w) {
      const end = w.t0 + w.step * (w.count - 1);
      const lead = dir > 0 ? end - t : t - w.t0;
      if (t >= w.t0 && t <= end && lead > (end - w.t0) / 2) return;
    }

    // Janela de ~4 s reais à frente (mais longa quando o tempo está acelerado).
    const n = this.items.length;
    const span = Math.min(Math.max(4000 * Math.max(1, Math.abs(multiplier)), 10_000), 600_000);
    const maxCount = Math.min(Math.max(Math.floor(MAX_PROPAGATIONS / n), 4), 200);
    const step = Math.min(Math.max(2000, span / (maxCount - 2)), 60_000);
    const count = Math.ceil(span / step) + 2;
    const t0 = dir > 0 ? t - step : t - span - step;

    this.pending = true;
    const msg: PropagatorMessage = { type: "compute", gen: this.gen, reqId: ++this.reqId, t0, step, count };
    this.worker.postMessage(msg);
  }

  private onResult(m: { gen: number; t0: number; step: number; count: number; data: Float32Array }) {
    if (m.gen !== this.gen) return;
    this.pending = false;
    this.win = { t0: m.t0, step: m.step, count: m.count, data: m.data };
    this.lastT = NaN;
  }
}
