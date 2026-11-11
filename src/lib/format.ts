const COMPASS = ["N", "NNE", "NE", "ENE", "L", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];

export function compass(azimuthDeg: number): string {
  return COMPASS[Math.round((((azimuthDeg % 360) + 360) % 360) / 22.5) % 16];
}

const dayTime = new Intl.DateTimeFormat("pt-BR", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const timeOnly = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export const formatDayTime = (ms: number) => dayTime.format(ms);
export const formatTime = (ms: number) => timeOnly.format(ms);

export function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  return min < 1 ? "< 1 min" : `${min} min`;
}

export function formatAge(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours < 1) return "há menos de 1 h";
  if (hours < 48) return `há ${Math.round(hours)} h`;
  return `há ${Math.round(hours / 24)} dias`;
}
