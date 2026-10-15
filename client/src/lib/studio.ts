import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

const ADDRESS = "gyroz-api-base";
const REFRESH = "gyroz-refresh";

export function isApp() {
  return Capacitor.isNativePlatform();
}

export async function studioAddress() {
  if (!isApp()) return "";
  return (await Preferences.get({ key: ADDRESS })).value ?? "";
}

export async function saveStudioAddress(origin: string) {
  const base = origin.trim().replace(/\/$/, "");
  if (!/^https?:\/\/[^/\s]+/i.test(base)) {
    throw new Error("Enter the studio address, such as http://192.168.1.20:4000");
  }
  await Preferences.set({ key: ADDRESS, value: base });
  return base;
}

export async function readRefresh() {
  if (!isApp()) return null;
  return (await Preferences.get({ key: REFRESH })).value;
}

export async function writeRefresh(token: string | null) {
  if (!isApp()) return;
  if (token) await Preferences.set({ key: REFRESH, value: token });
  else await Preferences.remove({ key: REFRESH });
}

export async function preparePunch() {
  if (!isApp()) return;
  const { Camera } = await import("@capacitor/camera");
  const { Geolocation } = await import("@capacitor/geolocation");
  await Camera.requestPermissions({ permissions: ["camera"] });
  await Geolocation.requestPermissions();
}

export async function readPosition() {
  if (isApp()) {
    const { Geolocation } = await import("@capacitor/geolocation");
    const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
    return { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy ?? 0 };
  }
  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("This browser cannot read location."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error("Allow location, or request a correction.")), { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  });
  return { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy };
}
