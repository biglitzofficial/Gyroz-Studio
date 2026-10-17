import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { todayKey } from "@/lib/format";
import { useAuth } from "@/lib/auth";

export function useOpenPunch() {
  const { user } = useAuth();
  const office = user?.role.systemKey === "super_admin";
  const today = todayKey(user?.studio?.businessTimezone ?? "Asia/Kolkata");
  const query = useQuery({
    queryKey: ["attendance", "today", today],
    enabled: Boolean(user?.employeeId) && !office,
    queryFn: async () => (await api.get("/attendance", { params: { from: today, to: today } })).data.data as Array<{ employeeId: string; checkInAt?: string; checkOutAt?: string }>,
  });
  if (office) return { open: true, note: "" };
  if (query.isLoading) return { open: false, note: "" };
  const mine = (query.data ?? []).find((row) => String(row.employeeId) === user?.employeeId);
  if (mine?.checkOutAt) return { open: false, note: "You have punched out. Work stays locked until the next day you punch in." };
  if (!mine?.checkInAt) return { open: false, note: "Punch in before you log work. You can see what is assigned, and the form opens after you punch in." };
  return { open: true, note: "" };
}

export function PunchRequired() {
  const punch = useOpenPunch();
  if (punch.open || !punch.note) return null;
  return (
    <p className="mb-3 border border-line bg-white px-4 py-3 text-sm">
      {punch.note} <Link to="/attendance">Open attendance</Link>
    </p>
  );
}
