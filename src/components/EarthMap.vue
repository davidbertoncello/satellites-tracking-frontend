<template>
  <div class="map-root">
  <vc-viewer
    :shouldAnimate="true"
    :info-box="false"
    :selection-indicator="false"
    @ready="onViewerReady"
  >
    <vc-layer-imagery>
      <vc-imagery-provider-urltemplate
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        :minimum-level="0"
        :maximum-level="20"
      />
    </vc-layer-imagery>

    <template v-for="track in tracks" :key="track.id">
      <vc-entity
        v-if="track.position && satelliteStore.visibleTrackIds.has(track.id)"
        :name="track.name"
        :position="track.position"
        :billboard="
          track.type === 'iss'
            ? { image: '/space-station.png', scale: 0.05 }
            : undefined
        "
        :point="
          track.type === 'starlink'
            ? { pixelSize: 6, color: HUD_CYAN, outlineWidth: 0 }
            : undefined
        "
        :label="{
          text: track.name,
          font: HUD_LABEL_FONT,
          pixelOffset: [0, -18],
          showBackground: true,
          backgroundColor: 'rgba(2, 12, 22, 0.72)',
          fillColor: '#bff4ff',
        }"
      />
    </template>
  </vc-viewer>
  <HudOverlay />
  <ControlPanel />
  <SatelliteInfo />
  </div>
</template>

<script setup lang="ts">
import * as satelliteJS from "satellite.js";
import { markRaw, onBeforeUnmount, shallowRef, triggerRef, watch } from "vue";
import { STARLINK_GROUP, useSatelliteStore, satelliteService, trackSource } from "@/store/satellite";
import type { Satellite } from "@/types/satellite";
import { GroupPointsLayer, type LayerItem } from "@/lib/groupPointsLayer";
import { ecfKm, makeSatrec, orbitClassOf, ORBIT_CLASSES, periodMs } from "@/lib/orbit";
import ControlPanel from "./ControlPanel.vue";
import SatelliteInfo from "./SatelliteInfo.vue";
import HudOverlay from "./HudOverlay.vue";

/** Cores do tema HUD (as mesmas de src/style.css) para o que o Cesium desenha. */
const HUD_CYAN = "#38e1ff";
const HUD_AMBER = "#ffb02e";
const HUD_LABEL_FONT = '13px "Share Tech Mono", monospace';

/** Janela (s) gerada a partir do TLE, refeita antes de acabar. */
const TLE_WINDOW_SECONDS = 120;
const TLE_REFRESH_MS = 60_000;

interface Track {
  id: number;
  name: string;
  type: Satellite["type"];
  satellite: Satellite;
  satrec: satelliteJS.SatRec | null;
  /** "ephemeris" enquanto a efeméride SpaceX cobre o horário atual; senão "tle". */
  mode: "ephemeris" | "tle" | "loading";
  ephemerisStop: number | null;
  position: any;
}

const satelliteStore = useSatelliteStore();
const tracks = shallowRef<Track[]>([]);
let Cesium: any = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

let viewer: any = null;
let layer: GroupPointsLayer | null = null;
let clickHandler: any = null;
let selectionEntity: any = null;
let pathEntity: any = null;
let observerEntity: any = null;
let selectedSatrec: satelliteJS.SatRec | null = null;
let pathCache: { t: number; positions: any[] } | null = null;
const stopWatchers: (() => void)[] = [];

const onViewerReady = (readyObj: any) => {
  Cesium = readyObj.Cesium;
  viewer = readyObj.viewer;
  // Começa sobre o local de observação (o vue-cesium 3 não tem <vc-camera>).
  const o = satelliteStore.observer;
  viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(o.lon, o.lat, 20_000_000) });
  // O índice pode chegar antes ou depois do viewer ficar pronto.
  stopWatchers.push(
    watch(
      () => satelliteStore.satellites,
      (satellites) => satellites.length && startTracking(satellites),
      { immediate: true },
    ),
  );
  setupGroupLayer();
  setupSelection();
  setupObserver();
  setupClock();
};

onBeforeUnmount(() => {
  stopWatchers.forEach((stop) => stop());
  if (refreshTimer) clearInterval(refreshTimer);
  clickHandler?.destroy();
  layer?.destroy();
});

/** Pontos dos grupos do CelesTrak ligados no painel. */
function setupGroupLayer() {
  layer = new GroupPointsLayer(viewer, Cesium);
  stopWatchers.push(
    watch(
      () =>
        [
          satelliteStore.enabledGroups.join(","),
          satelliteStore.groupData,
          satelliteStore.satellites,
          satelliteStore.starlinkPlan,
        ] as const,
      () => {
        // ISS e Starlinks com efeméride são Entities: ligados ou não, nunca viram ponto
        // (assim desligar a ISS a esconde também dos grupos "estações" e "olho nu").
        const seen = new Set(satelliteStore.satellites.map((s) => s.id));
        const items: LayerItem[] = [];
        const starlinkLabel = satelliteStore.groups.find((g) => g.key === STARLINK_GROUP)?.label ?? "Starlink";
        const layers = [
          ...(satelliteStore.starlinkPlan.groupSources.length
            ? [{ key: STARLINK_GROUP, label: starlinkLabel, sources: satelliteStore.starlinkPlan.groupSources }]
            : []),
          ...satelliteStore.groups
            .filter((g) => g.key !== STARLINK_GROUP && satelliteStore.enabledGroups.includes(g.key))
            .map((g) => ({ key: g.key, label: g.label, sources: satelliteStore.groupData[g.key]?.satellites ?? [] })),
        ];
        for (const group of layers) {
          for (const source of group.sources) {
            if (seen.has(source.id)) continue;
            seen.add(source.id);
            items.push({
              id: source.id,
              name: source.name,
              groupKey: group.key,
              groupLabel: group.label,
              source,
              color: ORBIT_CLASSES[orbitClassOf(source)].color,
            });
          }
        }
        layer!.setItems(items);
        satelliteStore.layerCount = items.length;
      },
      { immediate: true },
    ),
    // Desligou a ISS ou a Starlink selecionada: fecha o painel do satélite.
    watch(
      () => [satelliteStore.showIss, satelliteStore.starlinkPlan] as const,
      () => {
        const sel = satelliteStore.selected;
        if (!sel) return;
        const visible =
          satelliteStore.visibleTrackIds.has(sel.id) || layer!.items.some((i) => i.id === sel.id);
        if (!visible) satelliteStore.select(null);
      },
      { flush: "post" },
    ),
    watch(
      () => satelliteStore.lighting,
      (on) => {
        const globe = viewer.scene.globe;
        globe.enableLighting = on;
        // Por padrão o Cesium apaga a iluminação com a câmera a menos de ~20.000 km;
        // aqui o terminador deve aparecer em qualquer zoom.
        globe.lightingFadeOutDistance = 1;
        globe.lightingFadeInDistance = 2;
        viewer.scene.requestRender();
      },
      { immediate: true },
    ),
  );
}

/** Clique seleciona; o selecionado ganha anel, nome e a trajetória de uma volta. */
function setupSelection() {
  selectionEntity = viewer.entities.add({
    show: false,
    position: new Cesium.CallbackProperty((time: any, result: any) => {
      if (!selectedSatrec) return undefined;
      const p = ecfKm(selectedSatrec, Cesium.JulianDate.toDate(time));
      return p ? Cesium.Cartesian3.fromElements(p.x * 1000, p.y * 1000, p.z * 1000, result) : undefined;
    }, false),
    // Ao seguir: câmera ~2.500 km ao sul e acima do satélite (leste, norte, cima).
    viewFrom: new Cesium.Cartesian3(0, -2_000_000, 1_500_000),
    point: {
      pixelSize: 16,
      color: Cesium.Color.TRANSPARENT,
      outlineColor: Cesium.Color.fromCssColorString(HUD_AMBER),
      outlineWidth: 2,
    },
    label: {
      text: "",
      font: HUD_LABEL_FONT,
      pixelOffset: new Cesium.Cartesian2(0, -22),
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString("rgba(2, 12, 22, 0.8)"),
      fillColor: Cesium.Color.fromCssColorString(HUD_AMBER),
    },
  });
  // Entity separada: com a trajetória junto, "seguir" miraria no centro da órbita.
  pathEntity = viewer.entities.add({
    show: false,
    polyline: {
      positions: new Cesium.CallbackProperty((time: any) => orbitPath(time), false),
      width: 6,
      material: new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.2,
        taperPower: 1,
        color: Cesium.Color.fromCssColorString(HUD_CYAN).withAlpha(0.75),
      }),
      arcType: Cesium.ArcType.NONE,
    },
  });

  clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  clickHandler.setInputAction((event: any) => {
    const picked = viewer.scene.pick(event.position);
    if (!Cesium.defined(picked)) {
      satelliteStore.select(null);
      return;
    }
    if (layer?.owns(picked.collection) && typeof picked.id === "number") {
      const item = layer.items[picked.id];
      if (item) satelliteStore.select(item.source, item.groupLabel);
      return;
    }
    if ([selectionEntity, pathEntity, observerEntity].includes(picked.id)) return;
    const name = picked.id?.name;
    const track = satelliteStore.satellites.find((s) => s.name === name);
    if (track) satelliteStore.select(trackSource(track));
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  stopWatchers.push(
    watch(
      () => satelliteStore.selected,
      (sel) => {
        selectedSatrec = sel ? makeSatrec(sel.source) : null;
        pathCache = null;
        selectionEntity.show = pathEntity.show = !!selectedSatrec;
        // Os satélites fixos já têm rótulo próprio.
        selectionEntity.label.show = !!sel && !sel.isTrack;
        selectionEntity.label.text = sel?.name ?? "";
        if (!sel) viewer.trackedEntity = undefined;
        else if (satelliteStore.following) viewer.trackedEntity = selectionEntity;
      },
    ),
    watch(
      () => satelliteStore.following,
      (follow) => {
        viewer.trackedEntity = follow && selectedSatrec ? selectionEntity : undefined;
      },
    ),
  );
}

/** Uma volta completa a partir de agora, no referencial fixo à Terra. */
function orbitPath(time: any) {
  if (!selectedSatrec) return [];
  const t = Cesium.JulianDate.toDate(time).getTime();
  const period = periodMs(selectedSatrec);
  if (pathCache && Math.abs(t - pathCache.t) < Math.min(30_000, period / 50)) return pathCache.positions;
  const positions = [];
  const samples = 240;
  for (let k = 0; k <= samples; k++) {
    const p = ecfKm(selectedSatrec, new Date(t - period * 0.05 + (period * 1.05 * k) / samples));
    if (p) positions.push(new Cesium.Cartesian3(p.x * 1000, p.y * 1000, p.z * 1000));
  }
  pathCache = { t, positions };
  return positions;
}

function setupObserver() {
  observerEntity = viewer.entities.add({
    point: {
      pixelSize: 9,
      color: Cesium.Color.fromCssColorString("#3dffa8"),
      outlineColor: Cesium.Color.fromCssColorString("rgba(2, 12, 22, 0.9)"),
      outlineWidth: 2,
    },
    label: {
      text: "VOCÊ",
      font: HUD_LABEL_FONT,
      pixelOffset: new Cesium.Cartesian2(0, -16),
      fillColor: Cesium.Color.fromCssColorString("#3dffa8"),
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString("rgba(2, 12, 22, 0.75)"),
    },
  });
  stopWatchers.push(
    watch(
      () => satelliteStore.observer,
      (o) => {
        observerEntity.position = Cesium.Cartesian3.fromDegrees(o.lon, o.lat, 0);
      },
      { immediate: true },
    ),
  );
}

/** Repassa o relógio do mapa ao store (~1x/s) para o painel de detalhes. */
function setupClock() {
  let last = 0;
  viewer.clock.onTick.addEventListener((clock: any) => {
    const ms = Cesium.JulianDate.toDate(clock.currentTime).getTime();
    if (Math.abs(ms - last) >= 1000) {
      last = ms;
      satelliteStore.clockMs = ms;
    }
  });
}

function startTracking(satellites: Satellite[]) {
  tracks.value = satellites.map((satellite) => ({
    id: satellite.id,
    name: satellite.name,
    type: satellite.type,
    satellite,
    satrec: satellite.tle
      ? satelliteJS.twoline2satrec(satellite.tle.line1, satellite.tle.line2)
      : null,
    mode: "tle",
    ephemerisStop: satellite.ephemeris ? Date.parse(satellite.ephemeris.stop) : null,
    position: null,
  }));

  // Mostra tudo já com TLE e troca para a efeméride quando ela terminar de baixar.
  refreshTlePositions();
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(refreshTlePositions, TLE_REFRESH_MS);

  for (const track of tracks.value) {
    const eph = track.satellite.ephemeris;
    if (eph && Date.now() < Date.parse(eph.stop)) {
      loadEphemeris(track).catch((err) => {
        console.warn(`Efeméride de ${track.name} indisponível, usando TLE`, err);
        track.mode = "tle";
      });
    }
  }
}

async function loadEphemeris(track: Track) {
  track.mode = "loading";
  const eph = await satelliteService.getEphemeris(track.satellite.ephemeris!.path);

  const start = Cesium.JulianDate.fromIso8601(eph.start);
  const stop = Cesium.JulianDate.fromIso8601(eph.stop);
  // Sem isso, a conversão J2000 -> Terra cai num modelo simplificado que
  // ignora precessão/nutação e erra dezenas de km.
  await Cesium.Transforms.preloadIcrfFixed(new Cesium.TimeInterval({ start, stop }));

  const count = eph.positions.length / 3;
  const times = new Array(count);
  const values = new Array(count);
  for (let k = 0; k < count; k++) {
    const offset = eph.times ? eph.times[k] : k * eph.step;
    times[k] = Cesium.JulianDate.addSeconds(start, offset, new Cesium.JulianDate());
    values[k] = new Cesium.Cartesian3(
      eph.positions[3 * k] * 1000,
      eph.positions[3 * k + 1] * 1000,
      eph.positions[3 * k + 2] * 1000,
    );
  }

  const position = new Cesium.SampledPositionProperty(Cesium.ReferenceFrame.INERTIAL);
  position.setInterpolationOptions({
    interpolationAlgorithm: Cesium.LagrangeInterpolation,
    interpolationDegree: 5,
  });
  position.addSamples(times, values);

  track.mode = "ephemeris";
  track.position = markRaw(position);
  triggerRef(tracks);
}

/** Gera amostras SGP4 para quem está sem efeméride (ISS, ou Starlink vencida). */
function refreshTlePositions() {
  const now = Date.now();
  let changed = false;
  for (const track of tracks.value) {
    if (track.mode === "ephemeris" && track.ephemerisStop && now >= track.ephemerisStop) {
      track.mode = "tle";
    }
    if (track.mode === "ephemeris" || !track.satrec) continue;
    // Durante "loading" mantém o TLE para o satélite já aparecer no mapa.
    track.position = markRaw(buildTlePosition(track.satrec, now));
    changed = true;
  }
  if (changed) triggerRef(tracks);
}

function buildTlePosition(satrec: satelliteJS.SatRec, fromMs: number) {
  const position = new Cesium.SampledPositionProperty();
  position.setInterpolationOptions({
    interpolationAlgorithm: Cesium.LagrangeInterpolation,
    interpolationDegree: 5,
  });
  for (let s = -10; s <= TLE_WINDOW_SECONDS; s += 10) {
    const time = new Date(fromMs + s * 1000);
    const pv = satelliteJS.propagate(satrec, time);
    if (!pv || typeof pv.position === "boolean" || !pv.position) continue;
    const ecf = satelliteJS.eciToEcf(pv.position, satelliteJS.gstime(time));
    position.addSample(
      Cesium.JulianDate.fromDate(time),
      new Cesium.Cartesian3(ecf.x * 1000, ecf.y * 1000, ecf.z * 1000),
    );
  }
  return position;
}
</script>

<style scoped>
.map-root {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>
