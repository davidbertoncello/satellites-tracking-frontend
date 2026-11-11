import type { Ephemeris, GroupData, SatelliteIndex } from "@/types/satellite";

// Dados estáticos em public/data, atualizados por `npm run update-data`.
const DATA_URL = `${import.meta.env.BASE_URL}data/`;

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(DATA_URL + path);
  if (!response.ok) {
    throw new Error(`Falha ao carregar ${path}: HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

class SatelliteService {
  getIndex(): Promise<SatelliteIndex> {
    return getJson<SatelliteIndex>("satellites.json");
  }

  getEphemeris(path: string): Promise<Ephemeris> {
    return getJson<Ephemeris>(path);
  }

  getGroup(path: string): Promise<GroupData> {
    return getJson<GroupData>(path);
  }
}

export { SatelliteService };
