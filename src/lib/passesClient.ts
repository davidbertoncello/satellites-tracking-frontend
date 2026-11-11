import type { Pass } from "@/lib/passes";
import type { PassRequest } from "@/workers/passes.worker";

type Channel = "single" | "bulk";

/** Um worker por canal: a busca em massa não atrasa a do satélite selecionado. */
const workers = new Map<Channel, Worker>();
const pending = new Map<number, { resolve: (p: Pass[]) => void; reject: (e: unknown) => void }>();
let nextId = 1;

function getWorker(channel: Channel): Worker {
  let worker = workers.get(channel);
  if (!worker) {
    worker = new Worker(new URL("../workers/passes.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent<{ reqId: number; passes: Pass[] }>) => {
      pending.get(ev.data.reqId)?.resolve(ev.data.passes);
      pending.delete(ev.data.reqId);
    };
    worker.onerror = (err) => {
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      workers.delete(channel);
    };
    workers.set(channel, worker);
  }
  return worker;
}

export function computePassesAsync(req: Omit<PassRequest, "reqId">, channel: Channel = "single"): Promise<Pass[]> {
  const reqId = nextId++;
  const worker = getWorker(channel);
  return new Promise((resolve, reject) => {
    pending.set(reqId, { resolve, reject });
    // Proxies reativos do Vue não são clonáveis: manda uma cópia simples.
    worker.postMessage(JSON.parse(JSON.stringify({ ...req, reqId })));
  });
}
