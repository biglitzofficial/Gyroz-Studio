import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, getAccessToken, refreshAccessToken } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { isApp } from "@/lib/studio";

export function LiveUpdates() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user) return;
    let stopped = false;
    let controller: AbortController | null = null;
    let retryTimer: number | undefined;
    let refreshTimer: number | undefined;
    let retry = 0;

    const connect = async () => {
      if (stopped) return;
      controller = new AbortController();
      try {
        let token = getAccessToken();
        if (!token) token = await refreshAccessToken();
        if (!token || stopped) return;
        const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "text/event-stream" };
        if (isApp()) headers["X-Gyroz-App"] = "1";
        const response = await fetch(`${api.defaults.baseURL}/live`, { headers, credentials: "include", signal: controller.signal });
        if (response.status === 401) {
          await refreshAccessToken();
          throw new Error("Sign in expired.");
        }
        if (!response.ok || !response.body) throw new Error("Live updates disconnected.");
        retry = 0;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!stopped) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          if (!frames.some((frame) => frame.split("\n").some((line) => line.startsWith("data:")))) continue;
          window.clearTimeout(refreshTimer);
          refreshTimer = window.setTimeout(() => {
            void queryClient.invalidateQueries({ refetchType: "active" });
          }, 400);
        }
      } catch {
        // The next attempt starts a fresh connection.
      }
      if (!stopped) {
        retry += 1;
        retryTimer = window.setTimeout(connect, Math.min(15000, 1000 * retry));
      }
    };

    void connect();
    const poll = isApp()
      ? window.setInterval(() => {
          void queryClient.invalidateQueries({ refetchType: "active" });
        }, 4000)
      : undefined;
    return () => {
      stopped = true;
      controller?.abort();
      window.clearTimeout(retryTimer);
      window.clearTimeout(refreshTimer);
      window.clearInterval(poll);
    };
  }, [user, queryClient]);

  return null;
}
