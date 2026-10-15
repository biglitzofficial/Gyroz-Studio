import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { preparePunch, readPosition } from "@/lib/studio";
import { inr, todayKey } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { Button, Empty, Field, LoadingRows, Notice, PageHeader, SaveAction, SavedMark, Select, Status, TextInput } from "@/components/ui";

export function EmployeesPage() {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("all");
  const [message, setMessage] = useState("");
  const queryClient = useQueryClient();
  const people = useQuery({ queryKey: ["employees", status], queryFn: async () => (await api.get("/employees", { params: { status, limit: 100 } })).data.data });
  const roles = useQuery({ queryKey: ["role-options"], queryFn: async () => (await api.get("/roles/options")).data.data as Array<{ id: string; name: string }>, enabled: open || can("employees.edit") });
  const setRole = useMutation({
    meta: { loading: "Updating the role", toast: "Role updated." },
    mutationFn: async ({ id, roleId }: { id: string; roleId: string }) => api.patch(`/employees/${id}`, { roleId }),
    onSuccess: () => { setMessage("Role updated."); queryClient.invalidateQueries({ queryKey: ["employees"] }); },
    onError: (error) => setMessage(errorMessage(error)),
  });
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", roleId: "", joiningDate: new Date().toISOString().slice(0, 10), designation: "", createLogin: true, temporaryPassword: "", mustChangePassword: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    meta: { loading: "Saving the person", toast: "Person added. They sign in with that email and password." },
    mutationFn: async () => api.post("/employees", form),
    onSuccess: () => { setOpen(false); setForm((current) => ({ ...current, firstName: "", lastName: "", email: "", phone: "", roleId: "", designation: "", temporaryPassword: "" })); setMessage("Person added. They sign in with that email and password."); queryClient.invalidateQueries({ queryKey: ["employees"] }); },
    onError: (error) => setMessage(errorMessage(error)),
  });
  const setEmployment = useMutation({
    meta: {
      loading: "Updating",
      toast: (_data: unknown, job: { employmentStatus: string }) => job.employmentStatus === "active" ? "Person activated." : "Person marked inactive. Their login is disabled.",
    },
    mutationFn: async ({ id, employmentStatus }: { id: string; employmentStatus: "active" | "inactive" }) => api.patch(`/employees/${id}`, { employmentStatus }),
    onSuccess: (_result, variables) => {
      setMessage(variables.employmentStatus === "active" ? "Person activated." : "Person marked inactive. Their login is disabled.");
      queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (error) => setMessage(errorMessage(error)),
  });
  return (
    <div>
      <PageHeader eyebrow="Company" title="People" text="Compensation and bank details stay hidden unless your role can see them." actions={can("employees.create") ? <Button onClick={() => setOpen((value) => !value)}>Add person</Button> : null} />
      <div className="mb-4 flex flex-wrap gap-2">
        {[["all", "All"], ["active", "Active"], ["inactive", "Inactive"]].map(([value, label]) => (
          <Button key={value} size="sm" variant={status === value ? "ink" : "ghost"} onClick={() => setStatus(value)}>{label}</Button>
        ))}
      </div>
      {message ? <p className="mb-3 text-sm">{message}</p> : null}
      {open ? (
        <form className="mb-6 grid gap-3 border border-line bg-white p-4 md:grid-cols-2" onSubmit={(event) => {
          event.preventDefault();
          const next: Record<string, string> = {};
          if (!/^[A-Za-z][A-Za-z .'-]{1,39}$/.test(form.firstName.trim())) next.firstName = "Enter a first name, 2–40 letters.";
          if (!/^[A-Za-z][A-Za-z .'-]{0,39}$/.test(form.lastName.trim())) next.lastName = "Enter a last name, 1–40 letters.";
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) || form.email.trim().length > 120) next.email = "Enter a valid email address.";
          if (!/^\d{10}$/.test(form.phone.trim())) next.phone = "Enter a 10-digit phone number.";
          if (form.designation.trim() && form.designation.trim().length > 40) next.designation = "Use 40 characters or fewer.";
          if (!form.roleId) next.roleId = "Choose a role.";
          if (!/^\d{4}-\d{2}-\d{2}$/.test(form.joiningDate)) next.joiningDate = "Choose a joining date.";
          if (form.temporaryPassword.length < 8 || form.temporaryPassword.length > 72 || !/[A-Za-z]/.test(form.temporaryPassword) || !/[0-9]/.test(form.temporaryPassword)) next.temporaryPassword = "Use at least 8 characters, with a letter and a number.";
          setErrors(next);
          if (Object.keys(next).length) return;
          save.mutate();
        }}>
          <Field label="First name" error={errors.firstName}><TextInput maxLength={40} value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} /></Field>
          <Field label="Last name" error={errors.lastName}><TextInput maxLength={40} value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} /></Field>
          <Field label="Email" error={errors.email}><TextInput type="email" maxLength={120} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
          <Field label="Phone" error={errors.phone}><TextInput inputMode="numeric" maxLength={10} placeholder="10 digits" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></Field>
          <Field label="Designation" error={errors.designation}><TextInput maxLength={40} value={form.designation} onChange={(event) => setForm({ ...form, designation: event.target.value })} /></Field>
          <Field label="Role" error={errors.roleId}><Select value={form.roleId} onChange={(event) => setForm({ ...form, roleId: event.target.value })}><option value="">Select</option>{(roles.data ?? []).map((role: { id: string; name: string }) => <option key={role.id} value={role.id}>{role.name}</option>)}</Select></Field>
          <Field label="Joining date" error={errors.joiningDate}><TextInput type="date" value={form.joiningDate} onChange={(event) => setForm({ ...form, joiningDate: event.target.value })} /></Field>
          <Field label="Password" error={errors.temporaryPassword} hint="They sign in with this email and password. At least 8 characters, with a letter and a number."><TextInput type="password" autoComplete="new-password" maxLength={72} value={form.temporaryPassword} onChange={(event) => setForm({ ...form, temporaryPassword: event.target.value })} /></Field>
          <div className="md:col-span-2"><SaveAction changed pending={save.isPending} label="Save person" /></div>
        </form>
      ) : null}
      {(people.data ?? []).length ? (
        <div className="table-wrap"><table className="data"><thead><tr><th>Code</th><th>Name</th><th>Designation</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>
          {(people.data ?? []).map((person: { _id: string; employeeCode: string; firstName: string; lastName: string; designation?: string; roleId?: string; employmentStatus: string }) => (
            <tr key={person._id}>
              <td className="num">{person.employeeCode}</td>
              <td><Link to={`/employees/${person._id}`}>{person.firstName} {person.lastName}</Link></td>
              <td>{person.designation || "—"}</td>
              <td>{can("employees.edit") ? <Select aria-label={`Role for ${person.firstName} ${person.lastName}`} value={String(person.roleId || "")} disabled={setRole.isPending} onChange={(event) => setRole.mutate({ id: person._id, roleId: event.target.value })}>{(roles.data ?? []).map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</Select> : (roles.data ?? []).find((role) => role.id === String(person.roleId || ""))?.name || "—"}</td>
              <td><Status value={person.employmentStatus} /></td>
              <td>{can("employees.edit") ? <Button size="sm" variant={person.employmentStatus === "inactive" ? "primary" : "ghost"} disabled={setEmployment.isPending} onClick={() => setEmployment.mutate({ id: person._id, employmentStatus: person.employmentStatus === "inactive" ? "active" : "inactive" })}>{person.employmentStatus === "inactive" ? "Activate" : "Set inactive"}</Button> : null}</td>
            </tr>
          ))}
        </tbody></table></div>
      ) : <Empty title="No people yet" text="Add the studio team before assigning shoots." />}
    </div>
  );
}

export function EmployeeDetailPage() {
  const { id = "" } = useParams();
  const { can, user } = useAuth();
  const query = useQuery({ queryKey: ["employee", id], queryFn: async () => (await api.get(`/employees/${id}`)).data.data });
  const roles = useQuery({ queryKey: ["role-options"], queryFn: async () => (await api.get("/roles/options")).data.data as Array<{ id: string; name: string }>, enabled: can("employees.edit") || can("employees.create") || can("roles.manage") });
  if (query.isLoading) return <LoadingRows />;
  if (!query.data) return <Empty title="Record unavailable" text="You can open your own profile, or people you are allowed to view." />;
  const { employee, attendance, shoots, tasks, payslips } = query.data;
  const roleName = String(employee._id) === user?.employeeId || String(employee.id) === user?.employeeId
    ? user?.role.name
    : roles.data?.find((role) => role.id === String(employee.roleId || ""))?.name;
  const contact = [employee.emergencyContact?.name, employee.emergencyContact?.relation, employee.emergencyContact?.phone].filter(Boolean).join(" · ");
  return (
    <div>
      <PageHeader eyebrow={employee.employeeCode} title={`${employee.firstName} ${employee.lastName}`} text={roleName || employee.designation || employee.email} />
      <section className="mb-6 grid border border-line bg-white sm:grid-cols-2">
        <div className="border-b border-line px-4 py-3"><div className="eyebrow">Role</div><div className="mt-1">{roleName || "—"}</div></div>
        <div className="border-b border-line px-4 py-3"><div className="eyebrow">Email</div><div className="mt-1">{employee.email || "—"}</div></div>
        <div className="border-b border-line px-4 py-3"><div className="eyebrow">Designation</div><div className="mt-1">{employee.designation || "—"}</div></div>
        <div className="border-b border-line px-4 py-3"><div className="eyebrow">Phone</div><div className="mt-1">{employee.phone || "—"}</div></div>
        <div className="border-b border-line px-4 py-3"><div className="eyebrow">Joined</div><div className="mt-1">{employee.joiningDate || "—"}</div></div>
        <div className="border-b border-line px-4 py-3"><div className="eyebrow">Status</div><div className="mt-2"><Status value={employee.employmentStatus} /></div></div>
        <div className="border-b border-line px-4 py-3 sm:col-span-2"><div className="eyebrow">Emergency contact</div><div className="mt-1">{contact || "—"}</div></div>
        {employee.compensation ? <div className="border-b border-line px-4 py-3 sm:col-span-2"><div className="eyebrow">Pay</div><div className="mt-1">{employee.compensation.type === "monthly" ? `Monthly ${inr(employee.compensation.monthlySalaryPaise)}. A day is that salary divided by the days in the pay month.` : `Daily ${inr(employee.compensation.dailyRatePaise)}`}</div></div> : null}
        {employee.bank ? <div className="px-4 py-3 sm:col-span-2"><div className="eyebrow">Bank</div><div className="mt-1">{employee.bank.bankName || "—"} · {employee.bank.accountNumber || "—"}</div></div> : null}
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="border border-line bg-white p-4 text-sm">
          <h2 className="font-medium">Recent attendance</h2>
          {(attendance ?? []).slice(0, 8).map((row: { _id: string; dateKey: string; late?: boolean }) => <div key={row._id} className="mt-2">{row.dateKey} {row.late ? "· late" : ""}</div>)}
          <h2 className="mt-4 font-medium">Assigned work</h2>
          <p>{(shoots ?? []).length} shoots · {(tasks ?? []).length} editing tasks</p>
          {payslips ? <p className="mt-2">{payslips.length} payslips on file</p> : null}
        </section>
      </div>
    </div>
  );
}

function monthCells(anchor: string) {
  const [year, month] = anchor.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(year, month - 1, 1 - offset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { key, day: date.getDate(), weekday: date.getDay(), inMonth: date.getMonth() === month - 1 };
  });
}

function shiftMonth(anchor: string, delta: number) {
  const [year, month] = anchor.split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function AttendancePage() {
  const { can, user } = useAuth();
  const staffCalendar = can("attendance.self") && !can("attendance.view") && !can("attendance.manage");
  const [message, setMessage] = useState("");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopScan = useRef<(() => void) | null>(null);
  const direction = useRef<"punch-in" | "punch-out">("punch-in");
  const today = todayKey(user?.studio?.businessTimezone ?? "Asia/Kolkata");
  const queryClient = useQueryClient();
  const cells = monthCells(`${month}-01`);
  const rows = useQuery({
    queryKey: ["attendance", staffCalendar ? cells[0].key : "", staffCalendar ? cells[41].key : ""],
    queryFn: async () => (await api.get("/attendance", { params: staffCalendar ? { from: cells[0].key, to: cells[41].key } : {} })).data.data,
  });
  const todayRows = useQuery({
    queryKey: ["attendance", "today", today],
    queryFn: async () => (await api.get("/attendance", { params: { from: today, to: today } })).data.data as Array<{ employeeId: string; checkInAt?: string; checkOutAt?: string }>,
    enabled: Boolean(user?.employeeId),
  });
  const mine = (todayRows.data ?? []).find((row) => String(row.employeeId) === user?.employeeId);
  const punch = useMutation({
    meta: {
      loading: (job: { path: string }) => job.path === "punch-out" ? "Punching out" : "Punching in",
      toast: (result: { note?: string }) => result?.note || "Attendance recorded.",
    },
    mutationFn: async (body: { path: "punch-in" | "punch-out"; code: string; latitude: number; longitude: number; accuracy: number }) => (await api.post(`/attendance/${body.path}`, { code: body.code, latitude: body.latitude, longitude: body.longitude, accuracy: body.accuracy })).data.data as { note?: string },
    onSuccess: (result) => { setMessage(result.note || "Attendance recorded."); queryClient.invalidateQueries({ queryKey: ["attendance"] }); },
    onError: (error) => setMessage(errorMessage(error)),
  });
  direction.current = mine?.checkInAt ? "punch-out" : "punch-in";
  useEffect(() => () => stopScan.current?.(), []);
  async function scanOffice() {
    setScanError("");
    setMessage("");
    try { await preparePunch(); } catch { setScanError("Allow the camera and location, or request a correction below."); return; }
    if (!navigator.mediaDevices?.getUserMedia) {
      setScanError("This browser cannot scan a QR code. Request a correction below.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      setScanning(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const nativeDetector = window as unknown as { BarcodeDetector?: new (options: { formats: string[] }) => { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>> } };
      const Detector = nativeDetector.BarcodeDetector ?? (await import("barcode-detector/pure")).BarcodeDetector;
      const detector = new Detector({ formats: ["qr_code"] });
      let stopped = false;
      const stop = () => { stopped = true; stream.getTracks().forEach((track) => track.stop()); setScanning(false); };
      stopScan.current = stop;
      const tick = async () => {
        if (stopped || !videoRef.current) return;
        const found = await detector.detect(videoRef.current).catch(() => []);
        const raw = found[0]?.rawValue;
        if (raw) {
          stop();
          const position = await readPosition().catch((error: Error) => { setMessage(error.message); return null; });
          if (!position) return;
          punch.mutate({ path: direction.current, code: raw, latitude: position.latitude, longitude: position.longitude, accuracy: position.accuracy });
          return;
        }
        if (!stopped) window.requestAnimationFrame(() => void tick());
      };
      void tick();
    } catch {
      setScanning(false);
      setScanError("The camera is blocked. Allow it, or request a correction below.");
    }
  }
  return (
    <div>
      <PageHeader eyebrow="Time" title="Attendance" text="Scan the QR on the office screen. That screen is a separate link, so it cannot open the rest of the studio. The phone must be inside the office area. The day is 9:30 to 7:30, with 10 minutes of grace." />
      {can("attendance.self") && user?.employeeId ? (
        <section className="mb-6 border border-line bg-white p-4">
          <div className="text-sm text-muted">Today · {today}</div>
          <p className="mt-2 text-sm">{mine?.checkInAt ? `In ${new Date(mine.checkInAt).toLocaleTimeString("en-IN")}` : "Not punched in"}{mine?.checkOutAt ? ` · Out ${new Date(mine.checkOutAt).toLocaleTimeString("en-IN")}` : ""}</p>
          {mine?.checkOutAt ? <p className="mt-3 text-sm text-muted">Done for today</p> : (
            <div className="mt-3">
              <video ref={videoRef} className={scanning ? "mb-3 h-56 w-full max-w-sm bg-ink object-cover" : "hidden"} muted playsInline />
              <Button onClick={() => void scanOffice()} disabled={punch.isPending || scanning}>{punch.isPending ? "Saving" : scanning ? "Scanning" : mine?.checkInAt ? "Scan to punch out" : "Scan to punch in"}</Button>
              {scanError ? <p className="mt-2 text-sm text-danger">{scanError}</p> : null}
            </div>
          )}
          <PunchRequest today={today} />
        </section>
      ) : null}
      {can("attendance.correct") ? <PunchDecisions /> : null}
      {message ? <p className="mb-3 text-sm">{message}</p> : null}
      {can("attendance.manage") ? <PendingDecisions /> : null}
      {staffCalendar ? <AttendanceCalendar month={month} onMonth={setMonth} punches={rows.data ?? []} onChanged={() => setMessage("Saved. It shows on your calendar.")} /> : null}
      <div className="table-wrap"><table className="data"><thead><tr><th>Date</th><th>In</th><th>Out</th><th>Minutes</th><th>Mark</th></tr></thead><tbody>
        {(rows.data ?? []).map((row: { _id: string; dateKey: string; checkInAt?: string; checkOutAt?: string; minutes: number; late?: boolean; earlyDeparture?: boolean; locationStatus?: string }) => (
          <tr key={row._id}><td>{row.dateKey}</td><td>{row.checkInAt ? new Date(row.checkInAt).toLocaleTimeString("en-IN") : "—"}</td><td>{row.checkOutAt ? new Date(row.checkOutAt).toLocaleTimeString("en-IN") : "—"}</td><td className="num">{row.minutes}</td><td>{row.late ? "Late" : "On time"}{row.earlyDeparture ? " · left early" : ""}{row.checkInAt && !row.checkOutAt ? " · still in" : ""}{row.locationStatus === "outside" ? " · outside office" : row.locationStatus === "inside" ? " · in office" : ""}</td></tr>
        ))}
      </tbody></table></div>
    </div>
  );
}

function PunchRequest({ today }: { today: string }) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState("qr_failed");
  const [reason, setReason] = useState("");
  const [checkInTime, setCheckInTime] = useState("");
  const [checkOutTime, setCheckOutTime] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const save = useMutation({
    meta: { loading: "Requesting a correction", toast: "Correction requested." },
    mutationFn: async () => api.post("/attendance/exceptions", { dateKey: today, kind, reason: reason.trim(), checkInTime: checkInTime || undefined, checkOutTime: checkOutTime || undefined }),
    onSuccess: () => { setSaved(true); setError(""); queryClient.invalidateQueries({ queryKey: ["punch-exceptions"] }); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const dirty = reason.trim().length > 0 || Boolean(checkInTime || checkOutTime);
  return (
    <form className="mt-6 border-t border-line pt-4" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <h2 className="font-medium">QR or location failed</h2>
      <p className="mt-1 text-sm text-muted">Ask an admin to record the punch. The decision is kept.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="What failed"><Select value={kind} onChange={(event) => { setKind(event.target.value); setSaved(false); }}><option value="qr_failed">QR code</option><option value="location_failed">Location</option><option value="missed_punch">Missed punch</option></Select></Field>
        <Field label="Login"><TextInput type="time" value={checkInTime} onChange={(event) => { setCheckInTime(event.target.value); setSaved(false); }} /></Field>
        <Field label="Logout"><TextInput type="time" value={checkOutTime} onChange={(event) => { setCheckOutTime(event.target.value); setSaved(false); }} /></Field>
        <Field label="Reason"><TextInput maxLength={160} value={reason} onChange={(event) => { setReason(event.target.value); setSaved(false); }} placeholder="Why the scan did not work" /></Field>
      </div>
      <div className="mt-3">{saved && !dirty ? <SavedMark /> : <SaveAction changed={dirty} pending={save.isPending} label="Request correction" />}</div>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
    </form>
  );
}

function PunchDecisions() {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const people = useQuery({ queryKey: ["employees", "active"], queryFn: async () => (await api.get("/employees", { params: { status: "all", limit: 100 } })).data.data as Array<{ _id?: string; id?: string; firstName: string; lastName: string }> });
  const requests = useQuery({ queryKey: ["punch-exceptions"], queryFn: async () => (await api.get("/attendance/exceptions")).data.data as Array<{ _id: string; employeeId: string; dateKey: string; kind: string; reason: string; checkInTime?: string; checkOutTime?: string }> });
  const names = new Map((people.data ?? []).map((person) => [String(person._id ?? person.id), `${person.firstName} ${person.lastName}`.trim()]));
  const decide = useMutation({
    meta: { loading: "Saving the decision", toast: (_data: unknown, job: { status: string }) => job.status === "approved" ? "Approved." : "Rejected." },
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" }) => api.post(`/attendance/exceptions/${id}/decision`, { status, decisionNote: note.trim() }),
    onSuccess: () => { setNote(""); setError(""); queryClient.invalidateQueries({ queryKey: ["punch-exceptions"] }); queryClient.invalidateQueries({ queryKey: ["attendance"] }); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  if (!(requests.data ?? []).length) return null;
  return (
    <section className="mb-6 border border-line bg-white">
      <div className="border-b border-line px-4 py-3">
        <h2 className="font-medium">Punch corrections</h2>
        <p className="mt-1 text-sm text-muted">Approve only when the reason is real. The decision stays on the record.</p>
      </div>
      <div className="px-4 py-3"><Field label="Decision note"><TextInput value={note} onChange={(event) => setNote(event.target.value)} placeholder="Why this is approved or rejected" /></Field></div>
      {(requests.data ?? []).map((item) => (
        <div key={item._id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm">
          <div>
            <div className="font-medium">{names.get(String(item.employeeId)) || "Staff"} · {item.dateKey}</div>
            <div className="text-xs text-muted">{item.kind.replaceAll("_", " ")} · in {item.checkInTime || "—"} · out {item.checkOutTime || "—"}. {item.reason}</div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={note.trim().length < 2 || decide.isPending} onClick={() => decide.mutate({ id: item._id, status: "approved" })}>Approve</Button>
            <Button size="sm" variant="ghost" disabled={note.trim().length < 2 || decide.isPending} onClick={() => decide.mutate({ id: item._id, status: "rejected" })}>Reject</Button>
          </div>
        </div>
      ))}
      {error ? <p className="px-4 py-2 text-sm text-danger">{error}</p> : null}
    </section>
  );
}

function PendingDecisions() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const leave = useQuery({ queryKey: ["leave", "pending"], queryFn: async () => (await api.get("/leave", { params: { status: "pending" } })).data.data as Array<{ _id: string; employeeId: string; type: string; fromKey: string; toKey: string; reason: string }> });
  const overtime = useQuery({ queryKey: ["overtime", "pending"], queryFn: async () => (await api.get("/overtime")).data.data as Array<{ _id: string; employeeId: string; dateKey: string; minutes: number; reason: string; status: string }> });
  const people = useQuery({ queryKey: ["employees", "active"], enabled: can("employees.view"), queryFn: async () => (await api.get("/employees", { params: { status: "active", limit: 100 } })).data.data as Array<{ _id: string; id?: string; firstName: string; lastName: string }> });
  const names = new Map((people.data ?? []).map((person) => [String(person._id ?? person.id), `${person.firstName} ${person.lastName}`]));
  const decide = useMutation({
    meta: { loading: "Saving the decision", toast: (_data: unknown, job: { status: string }) => job.status === "approved" ? "Approved." : "Rejected." },
    mutationFn: async ({ path, id, status }: { path: "leave" | "overtime"; id: string; status: "approved" | "rejected" }) => api.post(`/${path}/${id}/decision`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave"] });
      queryClient.invalidateQueries({ queryKey: ["overtime"] });
      queryClient.invalidateQueries({ queryKey: ["desk"] });
    },
  });
  const pendingOt = (overtime.data ?? []).filter((item) => item.status === "pending");
  useEffect(() => {
    if (window.location.hash === "#approvals") document.getElementById("approvals")?.scrollIntoView({ block: "start" });
  }, [leave.data, overtime.data]);
  return (
    <section id="approvals" className="mb-6 border border-line bg-white">
      <div className="border-b border-line px-4 py-3">
        <h2 className="font-medium">Waiting for a decision</h2>
        <p className="mt-1 text-sm text-muted">Leave and overtime requested by staff. Approving here updates their month.</p>
      </div>
      {decide.isError ? <p className="px-4 py-2 text-sm text-danger">{errorMessage(decide.error)}</p> : null}
      {(leave.data ?? []).map((item) => (
        <div key={item._id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 text-sm">
          <div>
            <div className="font-medium">{names.get(String(item.employeeId)) ?? "Staff"} · {item.type} leave</div>
            <div className="text-xs text-muted">{item.fromKey} to {item.toKey}. {item.reason}</div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => decide.mutate({ path: "leave", id: item._id, status: "approved" })}>Approve</Button>
            <Button size="sm" variant="ghost" onClick={() => decide.mutate({ path: "leave", id: item._id, status: "rejected" })}>Reject</Button>
          </div>
        </div>
      ))}
      {pendingOt.map((item) => (
        <div key={item._id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 text-sm">
          <div>
            <div className="font-medium">{names.get(String(item.employeeId)) ?? "Staff"} · overtime</div>
            <div className="text-xs text-muted">{item.dateKey} · {item.minutes} min. {item.reason}</div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => decide.mutate({ path: "overtime", id: item._id, status: "approved" })}>Approve</Button>
            <Button size="sm" variant="ghost" onClick={() => decide.mutate({ path: "overtime", id: item._id, status: "rejected" })}>Reject</Button>
          </div>
        </div>
      ))}
      {!leave.data?.length && !pendingOt.length ? <p className="px-4 py-8 text-sm text-muted">No leave or overtime is waiting.</p> : null}
    </section>
  );
}

function AttendanceCalendar({ month, onMonth, punches, onChanged }: {
  month: string;
  onMonth: (month: string) => void;
  punches: Array<{ _id: string; dateKey: string; checkInAt?: string; checkOutAt?: string; minutes: number; late?: boolean }>;
  onChanged: () => void;
}) {
  const cells = monthCells(`${month}-01`);
  const [selected, setSelected] = useState(cells.find((cell) => cell.inMonth)?.key ?? `${month}-01`);
  const [leaveType, setLeaveType] = useState("paid");
  const [reason, setReason] = useState("");
  const [minutes, setMinutes] = useState("");
  const [error, setError] = useState("");
  const [requestKept, setRequestKept] = useState<"" | "leave" | "ot">("");
  const queryClient = useQueryClient();
  const leave = useQuery({ queryKey: ["leave", "mine"], queryFn: async () => (await api.get("/leave")).data.data as Array<{ _id: string; type: string; fromKey: string; toKey: string; status: string; reason: string }> });
  const overtime = useQuery({ queryKey: ["overtime", "mine"], queryFn: async () => (await api.get("/overtime")).data.data as Array<{ _id: string; dateKey: string; minutes: number; status: string; reason: string }> });
  const holidays = useQuery({ queryKey: ["holidays"], queryFn: async () => (await api.get("/holidays")).data.data as Array<{ dateKey: string; name: string }> });
  const shifts = useQuery({ queryKey: ["shifts"], queryFn: async () => (await api.get("/shifts")).data.data as Array<{ workingDays?: number[] }> });
  const workingDays = new Set(shifts.data?.[0]?.workingDays ?? [1, 2, 3, 4, 5, 6]);
  const askLeave = useMutation({
    meta: { loading: "Requesting leave", toast: "Leave requested." },
    mutationFn: async () => api.post("/leave", { type: leaveType, fromKey: selected, toKey: selected, reason: reason.trim() }),
    onSuccess: () => { setReason(""); setError(""); setRequestKept("leave"); onChanged(); queryClient.invalidateQueries({ queryKey: ["leave", "mine"] }); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const askOt = useMutation({
    meta: { loading: "Requesting overtime", toast: "Overtime requested." },
    mutationFn: async () => api.post("/overtime", { dateKey: selected, minutes: Number(minutes), reason: reason.trim() }),
    onSuccess: () => { setMinutes(""); setReason(""); setError(""); setRequestKept("ot"); onChanged(); queryClient.invalidateQueries({ queryKey: ["overtime", "mine"] }); },
    onError: (failure) => setError(errorMessage(failure)),
  });
  function marks(key: string, weekday: number) {
    const holiday = holidays.data?.find((item) => item.dateKey === key);
    const punch = punches.find((item) => item.dateKey === key);
    const off = leave.data?.find((item) => item.status !== "rejected" && item.fromKey <= key && item.toKey >= key);
    const extra = overtime.data?.find((item) => item.dateKey === key && item.status !== "rejected");
    const labels: string[] = [];
    if (punch) labels.push(punch.late ? "Late" : "Present");
    else if (off) labels.push(off.status === "approved" ? "Leave" : "Leave pending");
    else if (holiday) labels.push("Holiday");
    else if (!workingDays.has(weekday)) labels.push("Week off");
    if (extra) labels.push(extra.status === "approved" ? "OT" : "OT pending");
    return { labels, holiday, punch, off, extra };
  }
  const day = marks(selected, new Date(`${selected}T12:00:00`).getDay());
  const label = new Date(`${month}-01T12:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  return (
    <section className="mb-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">Your month</h2>
          <p className="text-sm text-muted">Present, late, leave, week off, and overtime for your login.</p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Button variant="ghost" onClick={() => { const next = shiftMonth(month, -1); onMonth(next); setSelected(`${next}-01`); }}>Previous</Button>
          <div className="min-w-0 flex-1 text-center text-sm font-medium sm:min-w-32 sm:flex-none">{label}</div>
          <Button variant="ghost" onClick={() => { const next = shiftMonth(month, 1); onMonth(next); setSelected(`${next}-01`); }}>Next</Button>
        </div>
      </div>
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {["Present", "Late", "Leave", "Week off", "OT"].map((item) => <span key={item} className="border border-line bg-white px-2 py-1">{item}</span>)}
      </div>
      <div className="month-grid border border-line bg-white">
        <div className="grid grid-cols-7 border-b border-line text-[11px] uppercase tracking-[0.14em] text-muted">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name) => <div key={name} className="px-1 py-2 text-center sm:px-2 sm:text-left">{name.slice(0, 1)}<span className="hidden sm:inline">{name.slice(1)}</span></div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((cell) => {
            const mark = marks(cell.key, cell.weekday);
            return (
              <button key={cell.key} type="button" aria-label={`${cell.key}, ${mark.labels.join(", ") || "open"}`} className={`relative min-h-24 border-b border-r border-line p-2 text-left ${cell.inMonth ? "bg-white" : "bg-paper text-muted"} ${cell.key === selected ? "shadow-[inset_0_2px_0_#FFD500]" : ""}`} onClick={() => setSelected(cell.key)}>
                <div className="num text-xs">{cell.day}</div>
                {mark.labels.length ? <span className="month-mark absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 bg-ink" /> : null}
                <div className="month-detail mt-1 space-y-1">
                  {mark.labels.map((item) => <div key={item} className="truncate text-[11px] font-medium">{item}</div>)}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-4 grid gap-4 border border-line bg-white p-4 md:grid-cols-2">
        <div className="text-sm">
          <div className="font-medium">{selected}</div>
          {day.punch ? <p className="mt-2">In {day.punch.checkInAt ? new Date(day.punch.checkInAt).toLocaleTimeString("en-IN") : "—"} · Out {day.punch.checkOutAt ? new Date(day.punch.checkOutAt).toLocaleTimeString("en-IN") : "—"} · {day.punch.minutes} min{day.punch.late ? " · late" : ""}</p> : null}
          {day.off ? <p className="mt-2">{day.off.type} leave · {day.off.status}. {day.off.reason}</p> : null}
          {day.extra ? <p className="mt-2">Overtime {day.extra.minutes} min · {day.extra.status}. {day.extra.reason}</p> : null}
          {day.holiday ? <p className="mt-2">Holiday · {day.holiday.name}</p> : null}
          {!day.punch && !day.off && !day.extra && !day.holiday ? <p className="mt-2 text-muted">{day.labels[0] || "Nothing recorded."}</p> : null}
        </div>
        <form className="grid gap-2" onSubmit={(event) => event.preventDefault()}>
          <Field label="Reason"><TextInput maxLength={160} value={reason} onChange={(event) => { setReason(event.target.value); setRequestKept(""); }} placeholder="Why you need leave or overtime" /></Field>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Leave"><Select value={leaveType} onChange={(event) => setLeaveType(event.target.value)}><option value="paid">Paid</option><option value="sick">Sick</option><option value="unpaid">Unpaid</option></Select></Field>
            {requestKept === "leave" && reason.trim().length < 2 ? <SavedMark /> : <SaveAction changed variant="ghost" type="button" pending={askLeave.isPending} label="Request leave" onClick={() => { if (reason.trim().length < 2) { setError("Enter a reason."); return; } askLeave.mutate(); }} />}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="OT minutes"><TextInput inputMode="numeric" value={minutes} onChange={(event) => { setMinutes(event.target.value); setRequestKept(""); }} placeholder="60" /></Field>
            {requestKept === "ot" && reason.trim().length < 2 && !minutes ? <SavedMark /> : <SaveAction changed variant="ghost" type="button" pending={askOt.isPending} label="Request OT" onClick={() => { if (reason.trim().length < 2 || !(Number(minutes) > 0)) { setError("Enter the overtime minutes and a reason."); return; } askOt.mutate(); }} />}
          </div>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </form>
      </div>
    </section>
  );
}

type PayslipRow = {
  _id: string;
  monthKey: string;
  employeeName?: string;
  employeeCode?: string;
  legalName?: string;
  payableDays?: number;
  unpaidAbsenceDays?: number;
  overtimeMinutes?: number;
  basePaise?: number;
  overtimePaise?: number;
  sundayPaise?: number;
  holidayPaise?: number;
  bonusesPaise?: number;
  statutoryPaise?: number;
  deductionsPaise?: number;
  lopPaise?: number;
  timeDeductionPaise?: number;
  advancesPaise?: number;
  adjustmentsPaise?: number;
  grossPaise?: number;
  netPaise?: number;
  flags?: string[];
  needsConfiguration?: boolean;
};

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char] ?? char));
}

function monthTitle(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  if (!year || !month) return monthKey;
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function downloadPayslip(slip: PayslipRow) {
  const lines = [
    ["Payable days", String(slip.payableDays ?? 0)],
    ["Unpaid absences", String(slip.unpaidAbsenceDays ?? 0)],
    ["Overtime minutes", String(slip.overtimeMinutes ?? 0)],
    ["Base", inr(slip.basePaise)],
    ["Overtime", inr(slip.overtimePaise)],
    ["Sunday extra", inr(slip.sundayPaise)],
    ["Holiday extra", inr(slip.holidayPaise)],
    ["Loss of pay", inr(slip.lopPaise)],
    ["Late or early", inr(slip.timeDeductionPaise)],
    ["Bonuses", inr(slip.bonusesPaise)],
    ["Statutory", inr(slip.statutoryPaise)],
    ["Deductions", inr(slip.deductionsPaise)],
    ["Advances", inr(slip.advancesPaise)],
    ["Adjustments", inr(slip.adjustmentsPaise)],
    ["Gross", inr(slip.grossPaise)],
  ].map(([label, value]) => `<div class="row"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`).join("");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>Payslip ${escapeHtml(slip.monthKey)}</title><style>
    body { margin: 0; color: #171717; font-family: Inter, "Segoe UI", sans-serif; background: #fff; }
    .bar { height: 8px; background: #ffd500; }
    main { max-width: 720px; margin: 0 auto; padding: 28px 40px 48px; }
    h1 { font-family: "Iowan Old Style", "Palatino Linotype", Palatino, serif; font-weight: 400; font-size: 36px; margin: 18px 0 0; }
    .muted { color: #666; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; }
    .top { display: flex; justify-content: space-between; align-items: flex-start; }
    .totals { width: 320px; margin-left: auto; margin-top: 28px; }
    .row, .total { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; border-bottom: 1px solid #f0eee8; }
    .total { border-top: 1px solid #171717; border-bottom: 0; margin-top: 6px; padding-top: 10px; font-weight: 600; }
    button { margin-top: 28px; height: 36px; padding: 0 14px; background: #ffd500; border: 0; cursor: pointer; }
    @media print { button { display: none; } }
  </style></head><body><div class="bar"></div><main>
    <div class="top"><div><h1>${escapeHtml(slip.legalName || "Gyroz Studio")}</h1><div class="muted">Payslip</div></div><div style="text-align:right"><div>${escapeHtml(monthTitle(slip.monthKey))}</div><div class="muted">${escapeHtml(slip.monthKey)}</div></div></div>
    <p><strong>${escapeHtml(slip.employeeName || "Employee")}</strong>${slip.employeeCode ? `<br />${escapeHtml(slip.employeeCode)}` : ""}</p>
    <div class="totals">${lines}<div class="total"><span>Net pay</span><span>${escapeHtml(inr(slip.netPaise))}</span></div></div>
    <p class="muted" style="letter-spacing:0;text-transform:none;margin-top:28px">Paid on the 5th of the next month. A Sunday adds one day's pay. Late and early minutes, and a missed working day, come off the monthly salary.</p>
    <button onclick="print()">Save PDF</button>
  </main></body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  window.open(url, "_blank", "noopener");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function PayrollPage() {
  const { can, user } = useAuth();
  const office = user?.role.systemKey === "super_admin";
  const [monthKey, setMonthKey] = useState(new Date().toISOString().slice(0, 7));
  const [ack, setAck] = useState(false);
  const [message, setMessage] = useState("");
  const [previewed, setPreviewed] = useState("");
  const queryClient = useQueryClient();
  const mine = useQuery({ queryKey: ["my-payslips"], queryFn: async () => (await api.get("/payroll/me/slips")).data.data as PayslipRow[], enabled: Boolean(user?.employeeId) });
  const period = useQuery({ queryKey: ["payroll", monthKey], queryFn: async () => (await api.get(`/payroll/${monthKey}`)).data.data, enabled: office });
  const preview = useMutation({
    meta: { loading: "Building the preview", toast: "Payroll preview ready." },
    mutationFn: async () => api.post("/payroll/preview", { monthKey }),
    onSuccess: () => { setPreviewed(monthKey); setMessage(""); queryClient.invalidateQueries({ queryKey: ["payroll", monthKey] }); },
    onError: (error) => setMessage(errorMessage(error)),
  });
  const finalize = useMutation({
    meta: { loading: "Sending payslips", toast: `Payslips for ${monthTitle(monthKey)} were sent to staff.` },
    mutationFn: async () => api.post(`/payroll/${monthKey}/finalize`, { statutoryAcknowledged: ack }),
    onSuccess: () => {
      setMessage(`Payslips for ${monthTitle(monthKey)} were sent to staff.`);
      queryClient.invalidateQueries({ queryKey: ["payroll", monthKey] });
      queryClient.invalidateQueries({ queryKey: ["my-payslips"] });
    },
    onError: (error) => setMessage(errorMessage(error)),
  });
  const slips = mine.data ?? [];
  return (
    <div>
      <PageHeader eyebrow="Pay" title="Payroll" text={office ? "Choose a month to see every person's payroll. Each person only receives their own slip." : "Your payslips appear here after that month is finalized. You can download your own."} />
      {user?.employeeId ? <section className="mb-6 border border-line bg-white">
        <h2 className="border-b border-line px-4 py-3 font-medium">Your payslips</h2>
        {slips.length ? (
          <table className="data">
            <thead><tr><th>Month</th><th>Payable days</th><th>Gross</th><th>Net</th><th></th></tr></thead>
            <tbody>
              {slips.map((slip) => (
                <tr key={slip._id}>
                  <td>{monthTitle(slip.monthKey)}</td>
                  <td className="num">{slip.payableDays ?? 0}</td>
                  <td className="num">{inr(slip.grossPaise)}</td>
                  <td className="num">{inr(slip.netPaise)}</td>
                  <td><Button size="sm" variant="ghost" onClick={() => downloadPayslip({ ...slip, employeeName: slip.employeeName || user?.name })}>Download</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="px-4 py-8 text-sm text-muted">No finalized payslip yet. It appears here after the month is closed.</p>}
      </section> : null}
      {office ? (
        <section className="border border-line bg-white">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 py-3">
            <h2 className="font-medium">Studio payroll · {monthTitle(monthKey)}</h2>
            <TextInput className="w-40" type="month" value={monthKey} onChange={(event) => setMonthKey(event.target.value)} aria-label="Payroll month" />
          </div>
          <Notice>Monthly pay is the salary for the month. One day is that salary divided by the days in the month. A Sunday punch adds one day. A missed Monday to Saturday is loss of pay. Salary date is the 5th of the next month.</Notice>
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            {period.data?.period?.status === "finalized" ? <SavedMark /> : (
              <>
                {previewed === monthKey ? <SavedMark /> : <Button onClick={() => preview.mutate()} disabled={preview.isPending}>{preview.isPending ? "Saving" : "Build preview"}</Button>}
                {can("payroll.approve") ? <Button variant="ink" onClick={() => finalize.mutate()} disabled={finalize.isPending}>{finalize.isPending ? "Saving" : "Finalize and send"}</Button> : null}
              </>
            )}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} /> I acknowledge statutory deductions are unconfigured</label>
          </div>
          {message ? <p className="px-4 pb-3 text-sm">{message}</p> : null}
          {period.data?.payslips?.length ? (
            <table className="data">
              <thead><tr><th>Employee</th><th>Payable days</th><th>Base</th><th>Net</th><th>Flags</th></tr></thead>
              <tbody>
                {period.data.payslips.map((slip: PayslipRow) => (
                  <tr key={slip._id}><td>{slip.employeeCode ? `${slip.employeeCode} · ${slip.employeeName}` : slip.employeeName}</td><td className="num">{slip.payableDays}</td><td className="num">{inr(slip.basePaise)}</td><td className="num">{inr(slip.netPaise)}</td><td>{(slip.flags ?? []).join(", ") || "—"}{slip.needsConfiguration ? " · needs configuration" : ""}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="px-4 py-8 text-sm text-muted">No payroll has been prepared for {monthTitle(monthKey)}.</p>}
        </section>
      ) : null}
    </div>
  );
}
