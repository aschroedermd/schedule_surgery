export interface SalzPosition {
  lat: number;
  lng: number;
  revision: number;
  updatedAt: string;
}
export type SalzDirection = "north" | "south" | "east" | "west";
export type SalzPositionChange = { lat: number; lng: number } | { direction: SalzDirection };
export interface SalzTrackLocation extends SalzPosition {
  name: string;
  detail: string;
  mode: "preset" | "live" | "editor";
  editorToken?: string;
}
export const SALZ_PRESETS = {
  "3320": { name: "Carilion Roanoke Memorial Hospital", detail: "Main hospital · Roanoke, VA", lat: 37.25130, lng: -79.94148 },
  "3321": { name: "Carilion Roanoke Memorial Hospital", detail: "East side of campus · Roanoke, VA", lat: 37.25161, lng: -79.94043 },
  "3323": { name: "Riverside 3", detail: "Carilion Clinic · Roanoke, VA", lat: 37.25612, lng: -79.94403 }
} as const;
export function isSalzCoordinate(lat: unknown, lng: unknown): lat is number {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 85 && Math.abs(lng) <= 180;
}
