<template>
  <aside class="panel hud-panel" :class="{ collapsed }">
    <header class="panel-header">
      <div class="brand">
        <img class="brand-logo" src="/logo.svg" alt="" width="34" height="34" />
        <h1>Rastreador <span class="h1-sub">de satélites</span></h1>
      </div>
      <button class="icon-btn" :title="collapsed ? 'Abrir painel' : 'Recolher painel'" @click="collapsed = !collapsed">
        {{ collapsed ? "☰" : "–" }}
      </button>
    </header>

    <div v-show="!collapsed" class="panel-body">
      <section>
        <h2>Camadas</h2>
        <div v-for="category in categories" :key="category.name" class="category">
          <h3>{{ category.name }}</h3>
          <label v-if="category.name === ISS_CATEGORY && hasIss" class="group-row">
            <input
              type="checkbox"
              :checked="store.showIss"
              @change="store.setShowIss(($event.target as HTMLInputElement).checked)"
            />
            <span class="group-label">ISS</span>
          </label>
          <div v-if="category.name === STARLINK_CATEGORY && store.starlinkMax" class="starlink">
            <label class="group-row">
              <input type="checkbox" :checked="store.starlinkEnabled" @change="onStarlinkToggle" />
              <span class="group-label">Starlink</span>
              <span class="count mono">
                <template v-if="store.loadingGroups.includes(STARLINK_GROUP)">…</template>
                <template v-else-if="store.starlinkEnabled">
                  {{ formatNumber(starlinkShown) }} de {{ formatNumber(store.starlinkMax) }}
                </template>
                <template v-else>{{ formatNumber(store.starlinkMax) }}</template>
              </span>
            </label>
            <form v-if="store.starlinkEnabled" class="starlink-form" @submit.prevent="applyStarlinkCount()">
              <label class="starlink-input">
                Quantos mostrar?
                <input
                  ref="starlinkInput"
                  v-model.number="starlinkDraft"
                  type="number"
                  min="1"
                  :max="store.starlinkMax"
                  step="1"
                  @change="applyStarlinkCount()"
                />
              </label>
              <div class="presets">
                <button
                  v-for="preset in starlinkPresets"
                  :key="preset.label"
                  type="button"
                  :class="{ active: store.starlinkCount === preset.value }"
                  @click="applyStarlinkCount(preset.value)"
                >
                  {{ preset.label }}
                </button>
              </div>
              <p class="muted small">
                Entre 1 e {{ formatNumber(store.starlinkMax) }}. Os {{ store.starlinkTracks.length }} primeiros usam a
                efeméride oficial da SpaceX; acima disso, o TLE do CelesTrak.
              </p>
              <p v-if="store.groupErrors[STARLINK_GROUP]" class="error small">
                Não foi possível carregar a lista completa da Starlink.
              </p>
            </form>
          </div>
          <label v-for="group in category.groups" :key="group.key" class="group-row">
            <input
              type="checkbox"
              :checked="store.enabledGroups.includes(group.key)"
              @change="store.toggleGroup(group.key, ($event.target as HTMLInputElement).checked)"
            />
            <span class="group-label">{{ group.label }}</span>
            <span class="count mono">
              <template v-if="store.loadingGroups.includes(group.key)">…</template>
              <template v-else-if="store.groupErrors[group.key]">erro</template>
              <template v-else>{{ formatNumber(group.count) }}</template>
            </span>
          </label>
        </div>
        <p v-if="store.layerCount" class="muted small">
          <span class="mono">{{ formatNumber(store.layerCount) }}</span> objetos dos grupos no mapa.
        </p>
      </section>

      <section>
        <h2>Cores por tipo de órbita</h2>
        <ul class="legend">
          <li v-for="(info, key) in ORBIT_CLASSES" :key="key" :title="info.hint">
            <span class="dot" :style="{ background: info.color, color: info.color }"></span>{{ info.label }}
          </li>
        </ul>
      </section>

      <section>
        <h2>Mapa</h2>
        <label class="group-row">
          <input type="checkbox" :checked="store.lighting" @change="store.setLighting(($event.target as HTMLInputElement).checked)" />
          <span class="group-label">Dia e noite (terminador)</span>
        </label>
      </section>

      <section>
        <h2>Local de observação</h2>
        <p class="small">
          {{ store.observer.label }}
          <span class="mono muted">{{ formatNumber(store.observer.lat, 3) }}°, {{ formatNumber(store.observer.lon, 3) }}°</span>
        </p>
        <div class="row">
          <button :disabled="locating" @click="useMyLocation">{{ locating ? "Localizando…" : "Usar minha localização" }}</button>
          <button class="link-btn" @click="editing = !editing">{{ editing ? "Cancelar" : "Editar" }}</button>
        </div>
        <p v-if="locationError" class="error small">{{ locationError }}</p>
        <form v-if="editing" class="coords" @submit.prevent="saveCoords">
          <label>Lat <input v-model.number="editLat" type="number" step="any" min="-90" max="90" required /></label>
          <label>Lon <input v-model.number="editLon" type="number" step="any" min="-180" max="180" required /></label>
          <button type="submit">Salvar</button>
        </form>
      </section>

      <section>
        <h2>Visíveis a olho nu (24 h)</h2>
        <p class="muted small">
          Passagens acima de 20° com o satélite iluminado pelo Sol e o céu escuro onde você está.
        </p>
        <button :disabled="tonightLoading" @click="computeTonight">
          {{ tonightLoading ? "Calculando…" : tonight ? "Recalcular" : "Calcular passagens" }}
        </button>
        <p v-if="tonightError" class="error small">{{ tonightError }}</p>
        <p v-else-if="tonight && !tonight.length" class="muted small">Nenhuma passagem visível nas próximas 24 h.</p>
        <ol v-if="tonight?.length" class="pass-list">
          <li v-for="pass in tonight" :key="`${pass.id}-${pass.start}`">
            <button class="pass-btn" @click="selectPass(pass)">
              <span class="pass-name">{{ pass.name }}</span>
              <span class="small mono">
                {{ formatDayTime(pass.start) }} · máx. {{ formatNumber(pass.maxElevation) }}° ·
                {{ compass(pass.startAzimuth) }} → {{ compass(pass.endAzimuth) }}
              </span>
            </button>
          </li>
        </ol>
      </section>

      <p v-if="store.generatedAt" class="muted small footer">
        Dados: CelesTrak e SpaceX, atualizados {{ formatAge(Date.now() - Date.parse(store.generatedAt)) }}
        (<code>npm run update-data</code>).
      </p>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { STARLINK_GROUP, trackSource, useSatelliteStore } from "@/store/satellite";
import { ORBIT_CLASSES } from "@/lib/orbit";
import { computePassesAsync } from "@/lib/passesClient";
import type { Pass } from "@/lib/passes";
import type { SatSource } from "@/types/satellite";
import { compass, formatAge, formatDayTime, formatNumber } from "@/lib/format";

const store = useSatelliteStore();
const collapsed = ref(window.innerWidth < 700);

const ISS_CATEGORY = "Estações";
const STARLINK_CATEGORY = "Megaconstelações";

const hasIss = computed(() => store.satellites.some((s) => s.type === "iss"));

const categories = computed(() => {
  const byName = new Map<string, typeof store.groups>();
  for (const g of store.groups) {
    if (!byName.has(g.category)) byName.set(g.category, []);
    // A Starlink tem controle próprio, com quantidade.
    if (g.key !== STARLINK_GROUP) byName.get(g.category)!.push(g);
  }
  return [...byName].map(([name, groups]) => ({ name, groups }));
});

// --- Starlink: liga/desliga + quantidade ---
const starlinkInput = ref<HTMLInputElement[] | HTMLInputElement | null>(null);
const starlinkDraft = ref<number | string>(store.starlinkCount);
watch(
  () => store.starlinkCount,
  (count) => (starlinkDraft.value = count),
);

const starlinkShown = computed(
  () => store.starlinkPlan.trackIds.size + store.starlinkPlan.groupSources.length,
);

const starlinkPresets = computed(() =>
  [
    { label: "20", value: 20 },
    { label: "100", value: 100 },
    { label: "1.000", value: 1000 },
    { label: "Todos", value: store.starlinkMax },
  ].filter((p, i, all) => p.value <= store.starlinkMax && all.findIndex((q) => q.value === p.value) === i),
);

async function onStarlinkToggle(event: Event) {
  const on = (event.target as HTMLInputElement).checked;
  await store.setStarlink(on);
  if (on) {
    // Ao ligar, já deixa o campo de quantidade pronto para digitar.
    await nextTick();
    const input = Array.isArray(starlinkInput.value) ? starlinkInput.value[0] : starlinkInput.value;
    input?.focus();
    input?.select();
  }
}

function applyStarlinkCount(value: number | string = starlinkDraft.value) {
  const count = Number(value);
  if (value === "" || !Number.isFinite(count)) {
    starlinkDraft.value = store.starlinkCount;
    return;
  }
  void store.setStarlink(true, count);
  // Mostra o valor já limitado ao intervalo válido.
  starlinkDraft.value = store.starlinkCount;
}

// --- Local de observação ---
const locating = ref(false);
const locationError = ref<string | null>(null);
const editing = ref(false);
const editLat = ref(store.observer.lat);
const editLon = ref(store.observer.lon);

function useMyLocation() {
  if (!("geolocation" in navigator)) {
    locationError.value = "Este navegador não informa a localização.";
    return;
  }
  locating.value = true;
  locationError.value = null;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      locating.value = false;
      store.setObserver({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: "Sua localização" });
      tonight.value = null;
    },
    (err) => {
      locating.value = false;
      locationError.value =
        err.code === err.PERMISSION_DENIED ? "Permissão de localização negada." : "Não foi possível obter a localização.";
    },
    { enableHighAccuracy: false, timeout: 15_000, maximumAge: 600_000 },
  );
}

function saveCoords() {
  store.setObserver({ lat: editLat.value, lon: editLon.value, label: "Local escolhido" });
  editing.value = false;
  tonight.value = null;
}

// --- Passagens visíveis ---
const tonight = ref<Pass[] | null>(null);
const tonightLoading = ref(false);
const tonightError = ref<string | null>(null);
const tonightSources = new Map<number, { source: SatSource; groupLabel: string | null }>();

async function computeTonight() {
  tonightLoading.value = true;
  tonightError.value = null;
  try {
    const [visual, stations] = await Promise.all([store.loadGroup("visual"), store.loadGroup("stations")]);
    tonightSources.clear();
    for (const s of store.satellites.filter((s) => s.type === "iss")) {
      tonightSources.set(s.id, { source: trackSource(s), groupLabel: null });
    }
    for (const [data, key] of [[stations, "stations"], [visual, "visual"]] as const) {
      const label = store.groups.find((g) => g.key === key)?.label ?? null;
      for (const s of data?.satellites ?? []) {
        if (!tonightSources.has(s.id)) tonightSources.set(s.id, { source: s, groupLabel: label });
      }
    }
    const from = Date.now();
    const passes = await computePassesAsync(
      {
        sats: [...tonightSources.values()].map((v) => v.source),
        observer: store.observer,
        fromMs: from,
        toMs: from + 86_400_000,
        minElevation: 10,
        onlyVisible: true,
        leoOnly: true,
      },
      "bulk",
    );
    tonight.value = passes.filter((p) => p.maxElevation >= 20).slice(0, 40);
  } catch (err) {
    tonightError.value = "Falha ao calcular as passagens.";
    console.error(err);
  } finally {
    tonightLoading.value = false;
  }
}

function selectPass(pass: Pass) {
  const entry = tonightSources.get(pass.id);
  if (entry) store.select(entry.source, entry.groupLabel);
}
</script>

<style scoped>
.panel {
  top: 12px;
  left: 12px;
  width: min(330px, calc(100vw - 24px));
  max-height: calc(100% - 24px);
}
.panel.collapsed {
  width: auto;
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.brand-logo {
  flex: none;
  width: 34px;
  height: 34px;
  filter: drop-shadow(0 0 6px rgba(56, 225, 255, 0.35));
}
.collapsed .brand-logo {
  width: 26px;
  height: 26px;
}
.h1-sub {
  display: block;
  margin-top: 3px;
  font-size: 10px;
  letter-spacing: 0.3em;
  color: var(--hud-cyan-soft);
  text-shadow: none;
}
.collapsed .h1-sub {
  display: none;
}
section + section {
  margin-top: 4px;
}
.group-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 3px 4px;
  margin: 0 -4px;
  cursor: pointer;
  transition: background 0.15s;
}
.group-row:hover {
  background: var(--hud-cyan-faint);
}
.group-label {
  flex: 1;
}
.count {
  color: var(--hud-muted);
  font-variant-numeric: tabular-nums;
}
.legend {
  list-style: none;
  padding: 0;
  margin: 0;
}
.legend li {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 2px 0;
}
.dot {
  width: 8px;
  height: 8px;
  flex: none;
  transform: rotate(45deg);
  box-shadow: 0 0 6px currentColor;
}
.row {
  display: flex;
  gap: 10px;
  align-items: center;
}
.panel .icon-btn {
  padding: 5px 9px;
  font-size: 13px;
}
.panel .link-btn {
  border: none;
  background: none;
  clip-path: none;
  padding: 0;
  color: var(--hud-amber);
}
.panel .link-btn:hover {
  background: none;
  box-shadow: none;
  color: #ffd27a;
}
.coords {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  margin-top: 8px;
}
.coords label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--hud-muted);
}
.coords input {
  width: 86px;
}
.starlink-form {
  margin: 4px 0 8px 22px;
  padding-left: 10px;
  border-left: 1px solid var(--hud-cyan-dim);
}
.starlink-input {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--hud-cyan-soft);
}
.starlink-input input {
  width: 84px;
}
.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin: 8px 0 2px;
}
.panel .presets button {
  padding: 4px 9px;
  font-size: 11px;
}
.pass-list {
  list-style: none;
  padding: 0;
  margin: 10px 0 0;
}
.panel .pass-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  width: 100%;
  text-align: left;
  text-transform: none;
  letter-spacing: 0;
  font: inherit;
  color: inherit;
  border: none;
  border-left: 2px solid transparent;
  background: none;
  clip-path: none;
  padding: 5px 8px;
}
.panel .pass-btn:hover {
  border-left-color: var(--hud-cyan);
  background: var(--hud-cyan-faint);
  box-shadow: none;
}
.pass-name {
  font-weight: 700;
  letter-spacing: 0.04em;
}
.footer {
  margin-top: 16px;
}
</style>
