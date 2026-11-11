import { defineStore } from "pinia";
import { markRaw } from "vue";
import { SatelliteService } from "@/services/satelliteService";
import type { Observer } from "@/lib/passes";
import type { GroupData, GroupInfo, Satellite, SatSource } from "@/types/satellite";

export interface NamedObserver extends Observer {
  label: string;
}

export interface SelectedSatellite {
  id: number;
  name: string;
  source: SatSource;
  groupLabel: string | null;
  /** É um dos satélites fixos (ISS/Starlink com efeméride), desenhados como Entity. */
  isTrack: boolean;
}

export const DEFAULT_OBSERVER: NamedObserver = { lat: -22.9068, lon: -43.1729, label: "Rio de Janeiro" };

const PREFS_KEY = "satellite-tracking:prefs";

interface Prefs {
  enabledGroups?: string[];
  observer?: NamedObserver;
  lighting?: boolean;
  showIss?: boolean;
  starlinkEnabled?: boolean;
  starlinkCount?: number;
}

/** O grupo "starlink" tem controle próprio (liga/desliga + quantidade), fora da lista de camadas. */
export const STARLINK_GROUP = "starlink";
export const DEFAULT_STARLINK_COUNT = 20;

/** Escolhe n itens espalhados pela lista (variedade de órbitas), como o update-data. */
function pickSpread<T>(list: T[], n: number): T[] {
  if (n >= list.length) return list;
  if (n <= 0) return [];
  const stride = list.length / n;
  return Array.from({ length: n }, (_, k) => list[Math.floor(k * stride)]);
}

function loadPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Prefs;
  } catch {
    return {};
  }
}

export function trackSource(s: Satellite): SatSource {
  return { id: s.id, name: s.name, line1: s.tle?.line1, line2: s.tle?.line2 };
}

const prefs = loadPrefs();
const satelliteService = new SatelliteService();

const useSatelliteStore = defineStore("satellite", {
  state: () => ({
    satellites: [] as Satellite[],
    generatedAt: null as string | null,
    groups: [] as GroupInfo[],
    enabledGroups: [] as string[],
    groupData: {} as Record<string, GroupData>,
    loadingGroups: [] as string[],
    groupErrors: {} as Record<string, string>,
    selected: null as SelectedSatellite | null,
    following: false,
    observer: prefs.observer ?? DEFAULT_OBSERVER,
    lighting: prefs.lighting ?? true,
    /** Relógio do mapa (ms), atualizado ~1x por segundo. */
    clockMs: Date.now(),
    layerCount: 0,
    showIss: prefs.showIss ?? true,
    starlinkEnabled: prefs.starlinkEnabled ?? true,
    starlinkCount: prefs.starlinkCount ?? DEFAULT_STARLINK_COUNT,
  }),
  getters: {
    getSatellites: (state): Satellite[] => {
      return state.satellites;
    },

    /** Starlinks desenhados como Entity, com efeméride oficial da SpaceX. */
    starlinkTracks: (state): Satellite[] => state.satellites.filter((s) => s.type === "starlink"),

    /** Total de Starlinks disponíveis (o grupo do CelesTrak inclui os com efeméride). */
    starlinkMax(state): number {
      const group = state.groups.find((g) => g.key === STARLINK_GROUP);
      return Math.max(group?.count ?? 0, this.starlinkTracks.length);
    },

    /**
     * Quais Starlinks mostrar: primeiro os com efeméride (mais precisos) e,
     * passando disso, o restante do grupo do CelesTrak, espalhado pela lista.
     */
    starlinkPlan(state): { trackIds: Set<number>; groupSources: SatSource[] } {
      if (!state.starlinkEnabled) return { trackIds: new Set(), groupSources: [] };
      const n = Math.min(state.starlinkCount, this.starlinkMax);
      const tracks = pickSpread(this.starlinkTracks, n);
      const trackIds = new Set(tracks.map((t) => t.id));
      const rest = n - tracks.length;
      const pool = (state.groupData[STARLINK_GROUP]?.satellites ?? []).filter(
        (s) => !this.starlinkTracks.some((t) => t.id === s.id),
      );
      return { trackIds, groupSources: pickSpread(pool, rest) };
    },

    /** Entities (ISS/Starlink com efeméride) que devem aparecer no mapa. */
    visibleTrackIds(state): Set<number> {
      const ids = new Set(this.starlinkPlan.trackIds);
      for (const s of state.satellites) if (s.type === "iss" && state.showIss) ids.add(s.id);
      return ids;
    },
  },
  actions: {
    async loadSatellites() {
      const index = await satelliteService.getIndex();
      this.satellites = index.satellites;
      this.generatedAt = index.generatedAt;
      this.groups = index.groups ?? [];
      const known = new Set(this.groups.map((g) => g.key));
      this.enabledGroups = (prefs.enabledGroups ?? []).filter((k) => known.has(k) && k !== STARLINK_GROUP);
      this.starlinkCount = this.clampStarlinkCount(this.starlinkCount);
      await Promise.all([...this.enabledGroups.map((k) => this.loadGroup(k)), this.ensureStarlinkData()]);
    },

    async loadGroup(key: string): Promise<GroupData | null> {
      if (this.groupData[key]) return this.groupData[key];
      const info = this.groups.find((g) => g.key === key);
      if (!info || this.loadingGroups.includes(key)) return null;
      this.loadingGroups.push(key);
      try {
        const data = markRaw(await satelliteService.getGroup(info.path));
        this.groupData = { ...this.groupData, [key]: data };
        delete this.groupErrors[key];
        return data;
      } catch (err) {
        this.groupErrors[key] = err instanceof Error ? err.message : String(err);
        return null;
      } finally {
        this.loadingGroups = this.loadingGroups.filter((k) => k !== key);
      }
    },

    async toggleGroup(key: string, on: boolean) {
      this.enabledGroups = on
        ? [...new Set([...this.enabledGroups, key])]
        : this.enabledGroups.filter((k) => k !== key);
      this.savePrefs();
      if (on) await this.loadGroup(key);
    },

    clampStarlinkCount(count: number): number {
      const max = this.starlinkMax || DEFAULT_STARLINK_COUNT;
      return Math.min(Math.max(Math.round(Number.isFinite(count) ? count : DEFAULT_STARLINK_COUNT), 1), max);
    },

    /** Passando dos Starlinks com efeméride, precisa do grupo completo. */
    async ensureStarlinkData() {
      if (this.starlinkEnabled && this.starlinkCount > this.starlinkTracks.length) {
        await this.loadGroup(STARLINK_GROUP);
      }
    },

    async setStarlink(enabled: boolean, count = this.starlinkCount) {
      this.starlinkEnabled = enabled;
      this.starlinkCount = this.clampStarlinkCount(count);
      this.savePrefs();
      await this.ensureStarlinkData();
    },

    setShowIss(on: boolean) {
      this.showIss = on;
      this.savePrefs();
    },

    select(source: SatSource | null, groupLabel: string | null = null) {
      if (!source) {
        this.selected = null;
        this.following = false;
        return;
      }
      this.selected = {
        id: source.id,
        name: source.name,
        source: markRaw(source),
        groupLabel,
        isTrack: this.satellites.some((s) => s.id === source.id),
      };
    },

    setObserver(observer: NamedObserver) {
      this.observer = observer;
      this.savePrefs();
    },

    setLighting(on: boolean) {
      this.lighting = on;
      this.savePrefs();
    },

    savePrefs() {
      const data: Prefs = {
        enabledGroups: this.enabledGroups,
        observer: this.observer,
        lighting: this.lighting,
        showIss: this.showIss,
        starlinkEnabled: this.starlinkEnabled,
        starlinkCount: this.starlinkCount,
      };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(data));
      } catch {
        // Sem localStorage (aba privada etc.): só não lembra as escolhas.
      }
    },
  },
});

export { useSatelliteStore, satelliteService };
