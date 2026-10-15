export function inr(paise?: number | null) {
  if (paise == null || Number.isNaN(Number(paise))) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(paise) / 100);
}

export function rupeesToPaise(value: string) {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
}

export function paiseToRupees(paise?: number | null) {
  if (paise == null) return "";
  const whole = Math.trunc(paise / 100);
  const fraction = String(Math.abs(paise % 100)).padStart(2, "0");
  return fraction === "00" ? String(whole) : `${whole}.${fraction}`;
}

export function formatWhen(value?: string | Date | null, timeZone = "Asia/Kolkata") {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", { timeZone, day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

export function formatStamp(value?: string | Date | null, timeZone = "Asia/Kolkata") {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", { timeZone, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function todayKey(timeZone = "Asia/Kolkata") {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function monthRange(timeZone = "Asia/Kolkata") {
  const key = todayKey(timeZone);
  return { from: `${key.slice(0, 8)}01`, to: key };
}

export function titleCase(value?: string | null) {
  if (!value) return "—";
  return value.replace(/_/g, " ");
}

export function elapsed(minutes?: number | null) {
  if (minutes == null) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours <= 0) return `${rest}m`;
  return `${hours}h ${rest}m`;
}

const SUCCESS = new Set(["paid", "published", "approved", "completed", "present", "finalized", "client_approved", "internal_approved", "active", "eligible"]);
const DANGER = new Set(["overdue", "failed", "rejected", "cancelled", "void", "rework", "absent", "disabled"]);
const WARNING = new Set(["on_hold", "pending_approval", "partially_paid", "late", "submitted", "pending", "admin_approved", "paused", "preview", "draft"]);
const ACCENT = new Set(["in_progress", "in_production", "claimed", "scheduled", "ready_to_publish", "in_post", "ready", "available"]);

export function statusTone(status?: string | null) {
  if (!status) return "neutral";
  if (SUCCESS.has(status)) return "success";
  if (DANGER.has(status)) return "danger";
  if (WARNING.has(status)) return "warning";
  if (ACCENT.has(status)) return "accent";
  return "neutral";
}
