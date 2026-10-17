import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { hasFullAccess, useAuth } from "@/lib/auth";
import { inr, paiseToRupees, rupeesToPaise, todayKey } from "@/lib/format";
import { OfficeMap } from "@/components/OfficeMap";
import { Button, Field, LoadingRows, Notice, PageHeader, SavedMark, Select, TextInput } from "@/components/ui";

type Shift = { _id: string; name: string; startTime: string; endTime: string; graceMinutes: number; workingDays?: number[] };
type Person = {
  id?: string;
  _id?: string;
  firstName: string;
  lastName: string;
  employeeCode?: string;
  designation?: string;
  employmentStatus?: string;
  shiftId?: string;
  compensation?: { type: "daily" | "monthly"; dailyRatePaise: number; monthlySalaryPaise: number; standardPayableDays: number };
};
type Punch = { _id: string; employeeId: string; dateKey: string; checkInAt?: string; checkOutAt?: string; late?: boolean; earlyDeparture?: boolean; minutes?: number };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function personId(person: Person) {
  return person.id || person._id || "";
}

function dayRatePaise(monthly: string, days: string) {
  const salary = rupeesToPaise(monthly);
  const count = Number(days);
  if (salary == null || !Number.isInteger(count) || count < 1 || count > 31) return null;
  return Math.round(salary / count);
}

function SalaryCells({ person, monthDays, onSave }: { person: Person; monthDays: number; onSave: (patch: Record<string, unknown>) => Promise<void> }) {
  const pay = person.compensation;
  const storedMonthly = pay?.type === "monthly" && pay.monthlySalaryPaise ? paiseToRupees(pay.monthlySalaryPaise) : "";
  const days = String(monthDays);
  const [monthly, setMonthly] = useState(storedMonthly);
  const [saved, setSaved] = useState(storedMonthly);
  const [saving, setSaving] = useState(false);
  const rate = dayRatePaise(monthly, days);
  const dirty = monthly !== saved;
  const id = personId(person);
  return (
    <>
      <td><TextInput className="w-28" inputMode="decimal" aria-label={`Monthly salary for ${person.firstName}`} value={monthly} onChange={(event) => setMonthly(event.target.value)} /></td>
      <td className="num">{monthDays}</td>
      <td className="num">{rate == null ? "—" : inr(rate)}</td>
      <td className="whitespace-nowrap">
        {dirty ? <Button size="sm" disabled={rate == null || saving} onClick={async () => {
          const salary = rupeesToPaise(monthly);
          const count = Number(days);
          if (salary == null || rate == null) return;
          setSaving(true);
          try {
            await onSave({ compensation: { type: "monthly", monthlySalaryPaise: salary, dailyRatePaise: rate, standardPayableDays: count } });
            setSaved(monthly);
          } finally { setSaving(false); }
        }}>{saving ? "Saving" : "Save"}</Button> : storedMonthly || saved ? <SavedMark /> : null}
      </td>
      <td className="whitespace-nowrap"><Link to={`/employees/${id}`}>Open record</Link></td>
    </>
  );
}

function clock(value?: string, zone = "Asia/Kolkata") {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}

export function HrmsPage() {
  const { user } = useAuth();
  const office = hasFullAccess(user?.role.systemKey);
  const zone = user?.studio?.businessTimezone ?? "Asia/Kolkata";
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const [startTime, setStartTime] = useState("09:30");
  const [endTime, setEndTime] = useState("19:30");
  const [grace, setGrace] = useState("10");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [overtime, setOvertime] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [dateKey, setDateKey] = useState(todayKey(zone));
  const [checkInTime, setCheckInTime] = useState("09:30");
  const [checkOutTime, setCheckOutTime] = useState("19:30");
  const [reason, setReason] = useState("");
  const [punchSaved, setPunchSaved] = useState(false);
  const [marked, setMarked] = useState<Record<string, true>>({});
  const [hoursStamp, setHoursStamp] = useState("");
  const [ratesStamp, setRatesStamp] = useState("");
  const [radius, setRadius] = useState("100");
  const [policy, setPolicy] = useState("reject");
  const [officeLat, setOfficeLat] = useState<number | null>(null);
  const [officeLng, setOfficeLng] = useState<number | null>(null);
  const [officeReady, setOfficeReady] = useState(false);
  const [screenKey, setScreenKey] = useState("");

  const shifts = useQuery({ queryKey: ["shifts"], queryFn: async () => (await api.get("/shifts")).data.data as Shift[], enabled: office });
  const people = useQuery({ queryKey: ["employees", "hrms"], queryFn: async () => (await api.get("/employees", { params: { status: "all", limit: 100 } })).data.data as Person[], enabled: office });
  const punches = useQuery({ queryKey: ["attendance", "hrms", dateKey], queryFn: async () => (await api.get("/attendance", { params: { from: dateKey, to: dateKey } })).data.data as Punch[], enabled: office });
  const settings = useQuery({ queryKey: ["settings"], queryFn: async () => (await api.get("/settings")).data.data, enabled: office });
  const shift = shifts.data?.[0];

  useEffect(() => {
    if (!shift) return;
    setStartTime(shift.startTime);
    setEndTime(shift.endTime);
    setGrace(String(shift.graceMinutes ?? 10));
    setDays(shift.workingDays ?? [1, 2, 3, 4, 5, 6]);
  }, [shift]);
  useEffect(() => {
    if (!settings.data) return;
    const payroll = settings.data.payroll;
    if (payroll) setOvertime(payroll.overtimePaisePerHour ? String(payroll.overtimePaisePerHour / 100) : "");
    if (officeReady) return;
    setRadius(String(settings.data.officeRadiusMeters ?? 100));
    setPolicy(settings.data.officeLocationPolicy === "flag" ? "flag" : "reject");
    setOfficeLat(typeof settings.data.officeLatitude === "number" ? settings.data.officeLatitude : null);
    setOfficeLng(typeof settings.data.officeLongitude === "number" ? settings.data.officeLongitude : null);
    setOfficeReady(true);
  }, [settings.data, officeReady]);

  const saveShift = useMutation({
    meta: { loading: "Saving hours", toast: "Hours saved." },
    mutationFn: async () => {
      const body = { name: shift?.name || "Studio floor", startTime, endTime, graceMinutes: Number(grace), workingDays: days };
      if (shift?._id) return api.patch(`/shifts/${shift._id}`, body);
      return api.post("/shifts", body);
    },
    onSuccess: () => { setMessage(""); setHoursStamp(`${startTime}|${endTime}|${grace}|${[...days].sort().join(",")}`); queryClient.invalidateQueries({ queryKey: ["shifts"] }); },
    onError: (error) => setMessage(errorMessage(error)),
  });
  const screenLink = useMutation({
    meta: { loading: "Creating the office link", toast: "Office link ready." },
    mutationFn: async () => (await api.post("/attendance/screen-link")).data.data as { key: string },
    onSuccess: (result) => { setScreenKey(result.key); setMessage(""); },
    onError: (error) => setMessage(errorMessage(error)),
  });
  const saveOffice = useMutation({
    meta: { loading: "Saving the office pin", toast: "Office pin saved." },
    mutationFn: async () => {
      const meters = Number(radius);
      if (officeLat == null || officeLng == null) throw new Error("Place the office on the map.");
      if (!Number.isInteger(meters) || meters < 30 || meters > 500) throw new Error("Use a radius from 30 to 500 metres.");
      return api.put("/settings", { officeLatitude: officeLat, officeLongitude: officeLng, officeRadiusMeters: meters, officeLocationPolicy: policy });
    },
    onSuccess: () => { setMessage(""); queryClient.invalidateQueries({ queryKey: ["settings"] }); },
    onError: (error) => setMessage(error instanceof Error && !("isAxiosError" in error) ? error.message : errorMessage(error)),
  });
  const savePay = useMutation({
    meta: { loading: "Saving rates", toast: "Rates saved." },
    mutationFn: async () => api.put("/settings", {
      payroll: {
        ...settings.data?.payroll,
        offdayMultiplier: null,
        overtimePaisePerHour: overtime === "" ? null : rupeesToPaise(overtime),
      },
    }),
    onSuccess: () => { setMessage(""); setRatesStamp(overtime); queryClient.invalidateQueries({ queryKey: ["settings"] }); },
    onError: (error) => setMessage(errorMessage(error)),
  });
  const savePerson = useMutation({
    meta: { loading: "Saving", toast: "Person saved." },
    mutationFn: async (body: { id: string; patch: Record<string, unknown> }) => api.patch(`/employees/${body.id}`, body.patch),
    onSuccess: () => { setMessage(""); queryClient.invalidateQueries({ queryKey: ["employees"] }); },
    onError: (error) => setMessage(errorMessage(error)),
  });
  const savePunch = useMutation({
    meta: { loading: "Saving times", toast: "Times saved." },
    mutationFn: async () => api.post("/attendance/corrections", { employeeId, dateKey, checkInTime, checkOutTime: checkOutTime || undefined, reason }),
    onSuccess: () => { setMessage(""); setPunchSaved(true); queryClient.invalidateQueries({ queryKey: ["attendance"] }); },
    onError: (error) => setMessage(errorMessage(error)),
  });

  if (!office) {
    return (
      <div className="max-w-xl">
        <PageHeader eyebrow="People" title="HRMS" text="Shift hours, allocation, and attendance corrections stay with an admin." />
        <Notice tone="danger">Only an admin can open HRMS.</Notice>
      </div>
    );
  }

  const names = new Map((people.data ?? []).map((person) => [personId(person), `${person.firstName} ${person.lastName}`]));
  const hoursNow = `${startTime}|${endTime}|${grace}|${[...days].sort().join(",")}`;
  const hoursBase = hoursStamp || (shift ? `${shift.startTime}|${shift.endTime}|${shift.graceMinutes ?? 10}|${[...(shift.workingDays ?? [1, 2, 3, 4, 5, 6])].sort().join(",")}` : "");
  const hoursDirty = Boolean(shift) && hoursNow !== hoursBase;
  const storedOvertime = settings.data?.payroll?.overtimePaisePerHour ? String(settings.data.payroll.overtimePaisePerHour / 100) : "";
  const ratesNow = overtime;
  const ratesBase = ratesStamp || (settings.data ? storedOvertime : "");
  const ratesDirty = Boolean(settings.data) && ratesNow !== ratesBase;
  const savedLat = typeof settings.data?.officeLatitude === "number" ? settings.data.officeLatitude : null;
  const savedLng = typeof settings.data?.officeLongitude === "number" ? settings.data.officeLongitude : null;
  const officeDirty = officeReady && (
    officeLat !== savedLat
    || officeLng !== savedLng
    || radius !== String(settings.data?.officeRadiusMeters ?? 100)
    || policy !== (settings.data?.officeLocationPolicy === "flag" ? "flag" : "reject")
  );

  return (
    <div>
      <PageHeader eyebrow="People" title="HRMS" text="The day is 9:30 to 7:30. Salary is paid on the 5th of the next month. A day rate is the monthly salary divided by the days in that month." />
      {shifts.isLoading || people.isLoading ? <LoadingRows /> : null}
      {message ? <p className="mb-4 text-sm">{message}</p> : null}

      <section className="mb-6 border border-line bg-white">
        <h2 className="border-b border-line px-4 py-3 font-medium">Studio hours</h2>
        <div className="grid gap-3 p-4 sm:grid-cols-4">
          <Field label="Login"><TextInput type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></Field>
          <Field label="Logout"><TextInput type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></Field>
          <Field label="Grace minutes" hint="10 minutes means a punch by 9:40, or a punch out from 7:20, is still a full day."><TextInput inputMode="numeric" value={grace} onChange={(event) => setGrace(event.target.value)} /></Field>
          <div className="flex items-end">{hoursDirty ? <Button onClick={() => saveShift.mutate()} disabled={saveShift.isPending}>{saveShift.isPending ? "Saving" : "Save hours"}</Button> : shift ? <SavedMark /> : null}</div>
        </div>
        <div className="flex flex-wrap gap-3 px-4 pb-4 text-sm">
          {DAYS.map((label, index) => (
            <label key={label} className="flex items-center gap-2">
              <input type="checkbox" checked={days.includes(index)} onChange={(event) => setDays((current) => event.target.checked ? [...current, index].sort() : current.filter((day) => day !== index))} />
              {label}
            </label>
          ))}
        </div>
      </section>

      <section className="mb-6 border border-line bg-white">
        <h2 className="border-b border-line px-4 py-3 font-medium">Office area</h2>
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <Field label="Radius in metres" hint="A punch farther than this is outside the studio. GPS may be off by up to 40 metres and still counts."><TextInput inputMode="numeric" value={radius} onChange={(event) => setRadius(event.target.value)} /></Field>
          <Field label="Outside the area"><Select value={policy} onChange={(event) => setPolicy(event.target.value)}><option value="reject">Reject the punch</option><option value="flag">Allow it and flag it</option></Select></Field>
          <div className="flex items-end">{officeDirty ? <Button onClick={() => saveOffice.mutate()} disabled={saveOffice.isPending}>{saveOffice.isPending ? "Saving" : "Save office area"}</Button> : officeLat != null && officeLng != null ? <SavedMark /> : null}</div>
        </div>
        <OfficeMap latitude={officeLat} longitude={officeLng} radius={Number(radius) || 100} onMove={(pin) => { setOfficeLat(pin.latitude); setOfficeLng(pin.longitude); }} />
        <div className="border-t border-line px-4 py-4">
          <h3 className="font-medium">Office screen</h3>
          <p className="mt-1 text-sm text-muted">This link shows only the QR code. It cannot open payroll, people, or settings. Open it on the reception computer and leave it there. A new link turns the previous one off.</p>
          <div className="mt-3"><Button onClick={() => screenLink.mutate()} disabled={screenLink.isPending}>{screenLink.isPending ? "Saving" : screenKey ? "Create a new link" : "Create office link"}</Button></div>
          <p className="mt-3 text-sm text-muted">The phone app already opens the live studio. Staff sign in and scan the QR on this screen while they are inside the yellow circle.</p>
          {screenKey ? <TextInput className="mt-3" readOnly value={`${window.location.origin}/reception?key=${screenKey}`} aria-label="Office screen link" onFocus={(event) => event.currentTarget.select()} /> : null}
        </div>
      </section>

      <section className="mb-6 border border-line bg-white">
        <h2 className="border-b border-line px-4 py-3 font-medium">Sunday, late, and loss of pay</h2>
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <p className="text-sm text-muted">A Sunday that is punched adds one day's pay on top of the monthly salary. After the grace, each late or early minute comes off that day. A punch with no punch-out holds back half a day. A Monday to Saturday with no punch, and no paid leave, is a full day's loss of pay.</p>
          <Field label="Overtime rupees per hour" hint="Used when extra minutes are approved. Leave blank until you decide."><TextInput inputMode="decimal" value={overtime} onChange={(event) => setOvertime(event.target.value)} placeholder="Leave blank" /></Field>
          <div className="flex items-end">{ratesDirty ? <Button onClick={() => { if (overtime !== "" && rupeesToPaise(overtime) == null) { setMessage("Enter overtime rupees with at most two decimal places."); return; } savePay.mutate(); }} disabled={savePay.isPending}>{savePay.isPending ? "Saving" : "Save rates"}</Button> : settings.data ? <SavedMark /> : null}</div>
        </div>
      </section>

      <section className="mb-6 border border-line bg-white">
        <div className="border-b border-line px-4 py-3">
          <h2 className="font-medium">People and shift</h2>
          <p className="mt-1 text-sm text-muted">Enter the monthly salary. Days follow the calendar month, so the per-day rate changes when the month is shorter or longer.</p>
        </div>
        {(people.data ?? []).length ? (
          <table className="data">
            <thead><tr><th>Person</th><th>Status</th><th>Shift</th><th>Monthly salary</th><th>Days</th><th>Per day</th><th></th><th></th></tr></thead>
            <tbody>
              {(people.data ?? []).map((person) => {
                const id = personId(person);
                return (
                  <tr key={id}>
                    <td><Link to={`/employees/${id}`}>{person.employeeCode ? `${person.employeeCode} · ` : ""}{`${person.firstName} ${person.lastName}`.trim()}</Link><div className="text-xs text-muted">{person.designation || "—"}</div></td>
                    <td>
                      <div className="flex items-center gap-2">
                        <Select value={person.employmentStatus || "active"} onChange={async (event) => { await savePerson.mutateAsync({ id, patch: { employmentStatus: event.target.value } }); setMarked((current) => ({ ...current, [`${id}:status`]: true })); }}>
                          <option value="active">Active</option>
                          <option value="on_leave">On leave</option>
                          <option value="inactive">Inactive</option>
                        </Select>
                        {marked[`${id}:status`] ? <SavedMark /> : null}
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <Select value={person.shiftId || shift?._id || ""} onChange={async (event) => { await savePerson.mutateAsync({ id, patch: { shiftId: event.target.value } }); setMarked((current) => ({ ...current, [`${id}:shift`]: true })); }}>
                          {(shifts.data ?? []).map((item) => <option key={item._id} value={item._id}>{item.name} · {item.startTime}–{item.endTime}</option>)}
                        </Select>
                        {marked[`${id}:shift`] ? <SavedMark /> : null}
                      </div>
                    </td>
                    <SalaryCells person={person} monthDays={new Date(Date.UTC(Number(todayKey(zone).slice(0, 4)), Number(todayKey(zone).slice(5, 7)), 0)).getUTCDate()} onSave={async (patch) => { await savePerson.mutateAsync({ id, patch }); }} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <p className="px-4 py-8 text-sm text-muted">No people yet. Add them from People.</p>}
      </section>

      <section className="border border-line bg-white">
        <h2 className="border-b border-line px-4 py-3 font-medium">Login and logout</h2>
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <Field label="Person">
            <Select value={employeeId} onChange={(event) => { setPunchSaved(false); setEmployeeId(event.target.value); }}>
              <option value="">Choose</option>
              {(people.data ?? []).map((person) => <option key={personId(person)} value={personId(person)}>{person.firstName} {person.lastName}</option>)}
            </Select>
          </Field>
          <Field label="Date"><TextInput type="date" value={dateKey} onChange={(event) => { setPunchSaved(false); setDateKey(event.target.value); }} /></Field>
          <Field label="Reason"><TextInput value={reason} onChange={(event) => { setPunchSaved(false); setReason(event.target.value); }} placeholder="Why this time is being set" /></Field>
          <Field label="Login"><TextInput type="time" value={checkInTime} onChange={(event) => { setPunchSaved(false); setCheckInTime(event.target.value); }} /></Field>
          <Field label="Logout"><TextInput type="time" value={checkOutTime} onChange={(event) => { setPunchSaved(false); setCheckOutTime(event.target.value); }} /></Field>
          <div className="flex items-end">{punchSaved ? <SavedMark /> : <Button onClick={() => { if (!employeeId || reason.trim().length < 2) { setMessage("Choose a person and enter a reason."); return; } savePunch.mutate(); }} disabled={savePunch.isPending}>{savePunch.isPending ? "Saving" : "Save times"}</Button>}</div>
        </div>
        {punches.data?.length ? (
          <table className="data">
            <thead><tr><th>Person</th><th>Login</th><th>Logout</th><th>Mark</th></tr></thead>
            <tbody>
              {punches.data.map((row) => (
                <tr key={row._id}>
                  <td><button type="button" className="text-left" onClick={() => { setPunchSaved(false); setEmployeeId(String(row.employeeId)); setCheckInTime(clock(row.checkInAt, zone) || "09:30"); setCheckOutTime(clock(row.checkOutAt, zone) || "19:30"); }}>{names.get(String(row.employeeId)) || "Person"}</button></td>
                  <td>{clock(row.checkInAt, zone) || "—"}</td>
                  <td>{clock(row.checkOutAt, zone) || "—"}</td>
                  <td>{row.late ? "Late" : "On time"}{row.earlyDeparture ? " · left early" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="px-4 py-6 text-sm text-muted">No attendance on {dateKey}. Set a login and logout above.</p>}
      </section>
    </div>
  );
}
