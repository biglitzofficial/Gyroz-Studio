import axios, { type AxiosError } from "axios";
import { isApp, readRefresh, saveStudioAddress, STUDIO_URL, writeRefresh } from "./studio";

export const api = axios.create({ baseURL: isApp() ? `${STUDIO_URL}/api/v1` : "/api/v1", withCredentials: true });

export async function loadStudio() {
  if (!isApp()) return;
  await saveStudioAddress(STUDIO_URL);
  api.defaults.baseURL = `${STUDIO_URL}/api/v1`;
}

let accessToken: string | null = null;
let refreshing: Promise<string | null> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  if (isApp()) config.headers["X-Gyroz-App"] = "1";
  return config;
});

api.interceptors.response.use((response) => {
  const refresh = (response.data as { data?: { refreshToken?: string } } | undefined)?.data?.refreshToken;
  if (isApp() && typeof refresh === "string") void writeRefresh(refresh);
  return response;
});

export async function refreshAccessToken() {
  return refreshAccess();
}

async function refreshAccess() {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const headers: Record<string, string> = {};
        const body: { refreshToken?: string } = {};
        if (isApp()) {
          headers["X-Gyroz-App"] = "1";
          const saved = await readRefresh();
          if (!saved) return null;
          body.refreshToken = saved;
        }
        const response = await axios.post(`${api.defaults.baseURL}/auth/refresh`, body, { withCredentials: true, headers });
        accessToken = response.data.data.accessToken as string;
        const next = response.data.data.refreshToken as string | undefined;
        if (isApp() && next) await writeRefresh(next);
        return accessToken;
      } catch {
        accessToken = null;
        return null;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (typeof error.config & { retried?: boolean }) | undefined;
    if (error.response?.status === 401 && original && !original.retried && !original.url?.includes("/auth/")) {
      original.retried = true;
      const token = await refreshAccess();
      if (token) {
        original.headers = original.headers ?? {};
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      }
    }
    return Promise.reject(error);
  },
);

export function errorMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { error?: { message?: string } } | undefined)?.error?.message;
    return message ?? "The request could not be completed.";
  }
  return "The request could not be completed.";
}

export async function restoreSession() {
  const token = await refreshAccess();
  if (!token) return null;
  const me = await api.get("/auth/me");
  return me.data.data;
}
