<template>
  <div class="hud-overlay" aria-hidden="true">
    <div class="vignette"></div>
    <div class="sweep"></div>
    <span class="corner tl"></span>
    <span class="corner tr"></span>
    <span class="corner bl"></span>
    <span class="corner br"></span>

    <div class="status">
      <span class="pulse"></span>
      <span class="item"><b>UTC</b> {{ utc }}</span>
      <span class="sep"></span>
      <span class="item"><b>OBJ</b> {{ formatNumber(objects) }}</span>
      <span class="sep"></span>
      <span class="item"><b>OBS</b> {{ formatNumber(store.observer.lat, 2) }}° {{ formatNumber(store.observer.lon, 2) }}°</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useSatelliteStore } from "@/store/satellite";
import { formatNumber } from "@/lib/format";

const store = useSatelliteStore();

/** Hora do relógio do mapa (não necessariamente "agora", se o tempo for acelerado). */
const utc = computed(() => new Date(store.clockMs).toISOString().slice(11, 19));
const objects = computed(() => store.layerCount + store.visibleTrackIds.size);
</script>

<style scoped>
.hud-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
  overflow: hidden;
}
.vignette {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at center, transparent 55%, rgba(0, 10, 20, 0.55) 100%),
    repeating-linear-gradient(0deg, rgba(56, 225, 255, 0.018) 0 1px, transparent 1px 4px);
}
.sweep {
  position: absolute;
  left: 0;
  right: 0;
  height: 120px;
  top: -120px;
  background: linear-gradient(180deg, transparent, rgba(56, 225, 255, 0.05) 85%, rgba(56, 225, 255, 0.18));
  animation: sweep 9s linear infinite;
}
@keyframes sweep {
  to {
    transform: translateY(calc(100vh + 120px));
  }
}
.corner {
  position: absolute;
  width: 34px;
  height: 34px;
  border: 0 solid var(--hud-cyan-soft);
  filter: drop-shadow(0 0 4px rgba(56, 225, 255, 0.6));
}
.tl {
  top: 4px;
  left: 4px;
  border-width: 1px 0 0 1px;
}
.tr {
  top: 4px;
  right: 4px;
  border-width: 1px 1px 0 0;
}
.bl {
  bottom: 4px;
  left: 4px;
  border-width: 0 0 1px 1px;
}
.br {
  bottom: 4px;
  right: 4px;
  border-width: 0 1px 1px 0;
}
.status {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 7px 22px;
  font: 13px/1 var(--hud-font-mono);
  color: var(--hud-cyan);
  white-space: nowrap;
  background: linear-gradient(90deg, transparent, rgba(2, 12, 22, 0.75) 15%, rgba(2, 12, 22, 0.75) 85%, transparent);
  border-top: 1px solid var(--hud-cyan-dim);
  border-bottom: 1px solid var(--hud-cyan-dim);
  text-shadow: 0 0 8px rgba(56, 225, 255, 0.5);
}
.status b {
  font: 600 9.5px/1 var(--hud-font-display);
  letter-spacing: 0.2em;
  color: var(--hud-amber);
  margin-right: 4px;
  text-shadow: none;
}
.sep {
  width: 1px;
  height: 12px;
  background: var(--hud-cyan-dim);
}
.pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--hud-cyan);
  box-shadow: 0 0 8px var(--hud-cyan);
  animation: pulse 1.6s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.25;
  }
}
/* Entre os dois painéis só cabe em telas largas. */
@media (max-width: 1100px) {
  .status {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .sweep,
  .pulse {
    animation: none;
  }
  .sweep {
    display: none;
  }
}
</style>
