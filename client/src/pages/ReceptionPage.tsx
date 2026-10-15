import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import QRCode from "qrcode";
import { api } from "@/lib/api";

const SHOW_MS = 30_000;

export function ReceptionPage() {
  const [params] = useSearchParams();
  const key = params.get("key") ?? "";
  const [code, setCode] = useState("");
  const [src, setSrc] = useState("");
  const [left, setLeft] = useState(30);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!key) {
      setError("This screen needs the office link from the super admin.");
      return;
    }
    let stop = false;
    let loading = false;
    let nextAt = 0;
    const load = async () => {
      if (loading || stop) return;
      loading = true;
      try {
        const response = await api.get("/attendance/screen", { params: { key } });
        if (stop) return;
        nextAt = Date.now() + SHOW_MS;
        setCode(response.data.data.code);
        setLeft(30);
        setError("");
      } catch {
        if (!stop) {
          nextAt = Date.now() + 5000;
          setError("This office link is no longer valid. Ask the super admin for a new one.");
        }
      } finally {
        loading = false;
      }
    };
    const tick = () => {
      if (!nextAt) return;
      setLeft(Math.max(0, Math.ceil((nextAt - Date.now()) / 1000)));
      if (Date.now() >= nextAt) void load();
    };
    void load();
    const timer = window.setInterval(tick, 250);
    return () => { stop = true; window.clearInterval(timer); };
  }, [key]);

  useEffect(() => {
    if (!code) return;
    QRCode.toDataURL(`GYROZ:${code}`, { margin: 1, width: 420, color: { dark: "#171717", light: "#fffdf8" } }).then(setSrc).catch(() => setSrc(""));
  }, [code]);

  return (
    <main className="safe-pad grid min-h-screen place-items-center bg-ink px-6 text-white">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 h-1 w-16 bg-accent" />
        <div className="font-display text-5xl">Gyroz</div>
        <p className="mt-3 text-sm text-white/70">Scan this with your own login. A new code arrives every 30 seconds and works once.</p>
        {src ? <img className="mx-auto mt-8 h-auto w-full max-w-[420px] bg-white p-4" src={src} width={420} height={420} alt="Office QR code" /> : null}
        {code ? <p className="mt-4 text-sm text-white/60">{left}s remaining on this code</p> : null}
        {error ? <p className="mt-6 text-sm">{error}</p> : null}
      </div>
    </main>
  );
}
