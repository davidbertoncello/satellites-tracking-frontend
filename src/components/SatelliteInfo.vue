<template>
  <aside v-if="selected" class="panel hud-panel">
    <header class="panel-header">
      <div>
        <h1>{{ selected.name }}</h1>
        <p class="muted small mono">
          NORAD {{ selected.id }}<template v-if="selected.groupLabel"> · {{ selected.groupLabel }}</template>
        </p>
      </div>
      <button class="icon-btn" title="Fechar" @click="store.select(null)">✕</button>
    </header>

    <p class="orbit-tag" :style="{ color: orbit.color }"><span class="orbit-dot"></span>{{ orbit.label }}</p>

    <dl v-if="details" class="stats">
      <dt>Altitude</dt>
      <dd>{{ formatNumber(details.altitudeKm) }} km</dd>
      <dt>Velocidade</dt>
      <dd>{{ formatNumber(details.speedKmS, 2) }} km/s</dd>
      <dt>Posição</dt>
      <dd>{{ formatNumber(details.latitude, 2) }}°, {{ formatNumber(details.longitude, 2) }}°</dd>
      <dt>Período</dt>
      <dd>{{ formatPeriod(details.periodMin) }}</dd>
      <dt>Inclinação</dt>
      <dd>{{ formatNumber(details.inclinationDeg, 1) }}°</dd>
      <dt>Perigeu / apogeu</dt>
      <dd>{{ formatNumber(details.perigeeKm) }} / {{ formatNumber(details.apogeeKm) }} km</dd>
      <dt>Elementos</dt>
      <dd :class="{ stale: store.clockMs - details.epochMs > 7 * 86_400_000 }">
        {{ formatAge(store.clockMs - details.epochMs) }}
      </dd>
    </dl>
    <p v-else class="error small">Sem posição válida para este horário (objeto pode ter reentrado).</p>

    <button :class="{ active: store.following }" @click="store.following = !store.following">
      {{ store.following ? "Parar de seguir" : "Seguir com a câmera" }}
    </button>

    <h2>Passagens sobre {{ store.observer.label }} (24 h)</h2>
    <p v-if="passesLoading" class="muted small">Calculando…</p>
    <p v-else-if="!passes.length" class="muted small">Não passa acima de 10° nas próximas 24 h.</p>
    <p v-else-if="passes[0].continuous" class="small">
      Sempre acima do horizonte, a cerca de {{ formatNumber(passes[0].maxElevation) }}° de elevação, na direção
      {{ compass(passes[0].startAzimuth) }}.
    </p>
    <ol v-else class="pass-list">
      <li v-for="pass in passes.slice(0, 10)" :key="pass.start">
        <div class="pass-when mono">
          {{ pass.inProgress ? "agora" : formatDayTime(pass.start) }}
          <span class="muted">· {{ formatDuration(pass.end - pass.start) }}</span>
          <span v-if="pass.visible" class="badge" title="Iluminado pelo Sol com o céu escuro: dá para ver a olho nu">
            visível
          </span>
        </div>
        <div class="small muted mono">
          máx. {{ formatNumber(pass.maxElevation) }}° às {{ formatTime(pass.maxTime) }} ·
          {{ compass(pass.startAzimuth) }} → {{ compass(pass.endAzimuth) }}
        </div>
      </li>
    </ol>
  </aside>
</template>

<script setup lang="ts">
import { computed, markRaw, ref, watch } from "vue";
import { useSatelliteStore } from "@/store/satellite";
import { makeSatrec, orbitClassOf, orbitDetails, ORBIT_CLASSES } from "@/lib/orbit";
import { computePassesAsync } from "@/lib/passesClient";
import type { Pass } from "@/lib/passes";
import { compass, formatAge, formatDayTime, formatDuration, formatNumber, formatTime } from "@/lib/format";

const store = useSatelliteStore();
const selected = computed(() => store.selected);

const satrec = computed(() => {
  const s = selected.value ? makeSatrec(selected.value.source) : null;
  return s ? markRaw(s) : null;
});
const orbit = computed(() => ORBIT_CLASSES[selected.value ? orbitClassOf(selected.value.source) : "LEO"]);
const details = computed(() => (satrec.value ? orbitDetails(satrec.value, new Date(store.clockMs)) : null));

function formatPeriod(min: number) {
  return min < 180 ? `${formatNumber(min, 1)} min` : `${formatNumber(min / 60, 1)} h`;
}

const passes = ref<Pass[]>([]);
const passesLoading = ref(false);
let token = 0;

watch(
  () => [selected.value?.id, store.observer.lat, store.observer.lon],
  async () => {
    const sel = selected.value;
    const my = ++token;
    passes.value = [];
    if (!sel) return;
    passesLoading.value = true;
    try {
      const from = Date.now();
      const result = await computePassesAsync({
        sats: [sel.source],
        observer: store.observer,
        fromMs: from,
        toMs: from + 86_400_000,
        minElevation: 10,
      });
      if (my === token) passes.value = result;
    } catch (err) {
      console.error(err);
    } finally {
      if (my === token) passesLoading.value = false;
    }
  },
  { immediate: true },
);
</script>

<style scoped>
.panel {
  top: 12px;
  right: 12px;
  width: min(320px, calc(100vw - 24px));
  max-height: calc(100% - 24px);
}
@media (max-width: 700px) {
  .panel {
    top: auto;
    bottom: 12px;
    max-height: 45%;
  }
}
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}
.panel h1 {
  font-size: 16px;
}
.orbit-tag {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
  font: 600 10.5px/1.2 var(--hud-font-display);
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
.orbit-dot {
  width: 7px;
  height: 7px;
  background: currentColor;
  box-shadow: 0 0 8px currentColor;
  transform: rotate(45deg);
}
.stats {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0;
  margin: 10px 0 14px;
  border-top: 1px solid var(--hud-cyan-dim);
}
dt,
dd {
  padding: 4px 0;
  border-bottom: 1px solid var(--hud-cyan-faint);
}
dt {
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--hud-muted);
  align-self: center;
}
dd {
  margin: 0;
  text-align: right;
  font-family: var(--hud-font-mono);
  font-size: 15px;
  color: var(--hud-cyan);
  text-shadow: 0 0 8px rgba(56, 225, 255, 0.35);
}
dd.stale {
  color: var(--hud-amber);
  text-shadow: 0 0 8px rgba(255, 176, 46, 0.35);
}
.panel .icon-btn {
  padding: 5px 9px;
  font-size: 13px;
}
.pass-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.pass-list li {
  padding: 6px 0 6px 10px;
  border-left: 2px solid var(--hud-cyan-dim);
  margin-bottom: 6px;
}
.pass-when {
  color: var(--hud-text);
}
.badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border: 1px solid var(--hud-amber);
  color: var(--hud-amber);
  font: 600 9.5px/1.3 var(--hud-font-display);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  box-shadow: 0 0 8px var(--hud-amber-dim);
}
</style>
