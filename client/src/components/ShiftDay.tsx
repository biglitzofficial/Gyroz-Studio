import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { todayKey } from "@/lib/format";
import { useAuth } from "@/lib/auth";

const START = 9 * 60 + 30;
const END = 19 * 60 + 30;
const DAY = END - START;

function minuteOf(date: Date, zone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map((part) => [part.type, part.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function clock(value: string | Date, zone: string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function span(minutes: number) {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest}m`;
  return `${hours}h ${String(rest).padStart(2, "0")}m`;
}

export function ShiftDay({ link = true }: { link?: boolean }) {
  const { user } = useAuth();
  const zone = user?.studio?.businessTimezone ?? "Asia/Kolkata";
  const [now, setNow] = useState(() => new Date());
  const today = todayKey(zone);
  const attendance = useQuery({
    queryKey: ["attendance", "today", today],
    enabled: Boolean(user?.employeeId),
    queryFn: async () => (await api.get("/attendance", { params: { from: today, to: today } })).data.data as Array<{ employeeId: string; checkInAt?: string; checkOutAt?: string }>,
  });
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15000);
    return () => window.clearInterval(timer);
  }, []);
  if (user?.role.systemKey === "super_admin") return null;
  const mine = (attendance.data ?? []).find((row) => String(row.employeeId) === user?.employeeId);
  const nowMinute = minuteOf(now, zone);
  const inMinute = mine?.checkInAt ? minuteOf(new Date(mine.checkInAt), zone) : null;
  const outMinute = mine?.checkOutAt ? minuteOf(new Date(mine.checkOutAt), zone) : null;
  const moving = outMinute ?? nowMinute;
  const done = inMinute == null ? 0 : Math.min(DAY, Math.max(0, Math.min(moving, END) - Math.max(inMinute, START)));
  const left = Math.max(0, END - Math.max(moving, START));
  const percent = Math.round((done / DAY) * 100);
  const state = mine?.checkOutAt
    ? `Punched out at ${clock(mine.checkOutAt, zone)}.`
    : mine?.checkInAt
      ? `Punched in at ${clock(mine.checkInAt, zone)}.`
      : nowMinute < START
        ? "The day starts at 9:30."
        : "Punch in to start the day.";
  return (
    <section className="mb-6 border border-line bg-white px-4 py-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Your day</div>
          <h2 className="mt-1 text-lg font-medium">9:30 to 7:30</h2>
        </div>
        <div className="text-right">
          <div className="num text-2xl">{span(done)}</div>
          <div className="text-xs text-muted">completed</div>
        </div>
      </div>
      <div className="mt-4 h-3 bg-[#f3f1eb]" role="progressbar" aria-valuemin={0} aria-valuemax={DAY} aria-valuenow={done} aria-label="Time completed from 9:30 to 7:30">
        <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted">
        <span>9:30</span>
        <span className="num text-sm text-ink">{span(left)} left</span>
        <span>7:30</span>
      </div>
      <p className="mt-3 text-sm">{state}{link ? <> <Link to="/attendance">Attendance</Link></> : null}</p>
    </section>
  );
}
