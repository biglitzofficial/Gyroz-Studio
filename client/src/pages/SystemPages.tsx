import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { api, errorMessage } from "@/lib/api";
import { withWork } from "@/lib/feedback";
import { rupeesToPaise } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { Button, Empty, Field, LoadingRows, Notice, PageHeader, SaveAction, Status, TextInput } from "@/components/ui";

export function RolesPage() {
  const query = useQuery({ queryKey: ["roles"], queryFn: async () => (await api.get("/roles")).data.data as Array<{ id: string; name: string; systemKey?: string; description?: string; permissions: string[] }> });
  const catalog = useQuery({ queryKey: ["permissions"], queryFn: async () => (await api.get("/permissions")).data.data as Array<{ key: string; group: string; resource: string; action: string }> });
  const queryClient = useQueryClient();
  const [active, setActive] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState("");
  const [permDirty, setPermDirty] = useState(false);
  const save = useMutation({
    meta: { loading: "Saving the role", toast: "Role saved." },
    mutationFn: async ({ id, permissions, name: roleName }: { id: string; permissions: string[]; name: string }) => api.patch(`/roles/${id}`, { name: roleName, permissions }),
    onSuccess: () => { setPermDirty(false); queryClient.invalidateQueries({ queryKey: ["roles"] }); },
  });
  const create = useMutation({
    meta: { loading: "Creating the role", toast: "Role created." },
    mutationFn: async (permissions: string[]) => (await api.post("/roles", { name: name.trim(), description: description.trim(), permissions })).data.data as Array<{ id: string; name: string }>,
    onSuccess: (roles) => {
      const created = roles.find((item) => item.name === name.trim());
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      queryClient.invalidateQueries({ queryKey: ["role-options"] });
      if (created) setActive(created.id);
      setCreating(false);
      setName("");
      setDescription("");
      setFormError("");
    },
    onError: (error) => setFormError(errorMessage(error)),
  });
  const role = creating ? null : (query.data ?? []).find((item) => item.id === active) ?? query.data?.[0];
  useEffect(() => { setPermDirty(false); }, [role?.id]);
  return (
    <div>
      <PageHeader eyebrow="Access" title="Roles" text="Staff titles are data. The server checks permissions, not the name of the role. Super admin cannot be edited or copied." actions={<Button onClick={() => { setCreating(true); setFormError(""); }}>{creating ? "Adding a role" : "New role"}</Button>} />
      {query.isLoading ? <LoadingRows /> : (
        <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
          <div className="border border-line bg-white">
            {(query.data ?? []).map((item) => (
              <button key={item.id} className={`block w-full border-b border-line px-3 py-3 text-left text-sm ${role?.id === item.id ? "bg-paper" : ""}`} type="button" onClick={() => { setCreating(false); setActive(item.id); }}>{item.name}</button>
            ))}
          </div>
          {creating ? (
            <form className="border border-line bg-white p-4" onSubmit={(event) => {
              event.preventDefault();
              if (!/^[A-Za-z][A-Za-z0-9 .'-]{1,39}$/.test(name.trim())) { setFormError("Enter a role name, 2–40 characters, starting with a letter."); return; }
              if (description.trim().length > 240) { setFormError("Use 240 characters or fewer for the description."); return; }
              const data = new FormData(event.currentTarget);
              const permissions = catalog.data?.filter((item) => item.key !== "roles.manage" && data.get(item.key) === "on").map((item) => item.key) ?? [];
              setFormError("");
              create.mutate(permissions);
            }}>
              <h2 className="font-medium">New role</h2>
              <p className="mb-4 text-sm text-muted">Choose what this role can do. It can be assigned when you add a person.</p>
              <Field label="Name"><TextInput maxLength={40} value={name} onChange={(event) => setName(event.target.value)} placeholder="Floor producer" /></Field>
              <Field label="Description"><TextInput maxLength={240} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What this person is responsible for" /></Field>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {(catalog.data ?? []).filter((item) => item.key !== "roles.manage").map((item) => (
                  <label key={item.key} className="flex items-center gap-2 text-sm"><input type="checkbox" name={item.key} /> {item.resource} · {item.action}</label>
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                <SaveAction changed pending={create.isPending} label="Create role" />
                <Button variant="ghost" onClick={() => { setCreating(false); setFormError(""); }}>Cancel</Button>
              </div>
              {formError ? <p className="mt-2 text-sm text-danger">{formError}</p> : null}
            </form>
          ) : role ? (
            <form key={role.id} className="border border-line bg-white p-4" onChange={() => setPermDirty(true)} onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const permissions = catalog.data?.filter((item) => data.get(item.key) === "on").map((item) => item.key) ?? []; save.mutate({ id: role.id, name: role.name, permissions }); }}>
              <h2 className="font-medium">{role.name}</h2>
              <p className="mb-4 text-sm text-muted">{role.description}</p>
              {role.systemKey === "super_admin" ? <p className="text-sm">This role always has full access and cannot be reduced.</p> : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {(catalog.data ?? []).map((item) => (
                    <label key={item.key} className="flex items-center gap-2 text-sm"><input type="checkbox" name={item.key} defaultChecked={role.permissions.includes(item.key)} /> {item.resource} · {item.action}</label>
                  ))}
                </div>
              )}
              {role.systemKey !== "super_admin" ? <SaveAction className="mt-4" changed={permDirty} stored pending={save.isPending} label="Save permissions" /> : null}
              {save.isError ? <p className="mt-2 text-sm text-danger">{errorMessage(save.error)}</p> : null}
            </form>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function SettingsPage() {
  const query = useQuery({ queryKey: ["settings"], queryFn: async () => (await api.get("/settings")).data.data });
  const [message, setMessage] = useState("");
  const [changed, setChanged] = useState(false);
  const save = useMutation({
    meta: { loading: "Saving", toast: "Settings saved." },
    mutationFn: async (body: Record<string, unknown>) => api.put("/settings", body),
    onSuccess: () => { setChanged(false); setMessage(""); },
    onError: (error) => setMessage(errorMessage(error)),
  });
  if (query.isPending) return <LoadingRows />;
  if (query.isError || !query.data) {
    return (
      <div className="max-w-xl">
        <PageHeader eyebrow="Studio" title="Settings" text="Tax, approval threshold, and payroll policy live here." />
        <Notice tone="danger">{errorMessage(query.error)}</Notice>
      </div>
    );
  }
  const settings = query.data;
  return (
    <>
    <form className="max-w-xl" onChange={() => setChanged(true)} onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const threshold = String(data.get("threshold") || "0").trim();
      const overtime = String(data.get("overtime") || "").trim();
      const thresholdPaise = rupeesToPaise(threshold || "0");
      const overtimePaise = overtime ? rupeesToPaise(overtime) : null;
      if (thresholdPaise == null || (overtime && overtimePaise == null)) {
        setMessage("Enter rupee amounts with at most two decimal places.");
        return;
      }
      save.mutate({
        legalName: data.get("legalName"),
        address: data.get("address"),
        gstin: data.get("gstin"),
        businessTimezone: data.get("businessTimezone"),
        defaultTaxRateBps: Number(data.get("defaultTaxRateBps") || 0),
        invoiceApprovalThresholdPaise: thresholdPaise,
        payroll: {
          ...settings.payroll,
          overtimePaisePerHour: overtimePaise,
          offdayMultiplier: null,
          salaryDay: 5,
        },
      });
    }}>
      <PageHeader eyebrow="Studio" title="Settings" text="Tax and the approval threshold live here. Sunday pay, the salary date, and late deductions are set in HRMS." />
      <div className="grid gap-3 border border-line bg-white p-4">
        <Field label="Legal name"><TextInput name="legalName" defaultValue={settings.legalName} /></Field>
        <Field label="Address"><TextInput name="address" defaultValue={settings.address} /></Field>
        <Field label="GSTIN"><TextInput name="gstin" defaultValue={settings.gstin} /></Field>
        <Field label="Timezone"><TextInput name="businessTimezone" defaultValue={settings.businessTimezone} /></Field>
        <Field label="Default tax (basis points, 1800 = 18%)"><TextInput name="defaultTaxRateBps" defaultValue={settings.defaultTaxRateBps} /></Field>
        <Field label="Invoice approval threshold (INR)"><TextInput name="threshold" defaultValue={Math.round((settings.invoiceApprovalThresholdPaise ?? 0) / 100)} /></Field>
        <Field label="Overtime rupees per hour"><TextInput name="overtime" placeholder="Leave blank until confirmed" defaultValue={settings.payroll?.overtimePaisePerHour ? settings.payroll.overtimePaisePerHour / 100 : ""} /></Field>
        <SaveAction changed={changed} stored pending={save.isPending} label="Save settings" />
        {message ? <p className="text-sm text-danger">{message}</p> : null}
      </div>
    </form>
    <DemoStudio />
    </>
  );
}

function DemoStudio() {
  const [message, setMessage] = useState("");
  const load = useMutation({
    meta: { loading: "Loading the demo", toast: "Demo studio loaded." },
    mutationFn: async () => api.post("/dev/seed"),
    onSuccess: () => setMessage("Demo studio loaded. Refresh the ledger to see Northwind Atelier."),
    onError: (error) => setMessage(errorMessage(error)),
  });
  return (
    <section className="mt-8 max-w-xl border border-line bg-white p-4">
      <h2 className="font-medium">Demo studio</h2>
      <p className="mt-1 text-sm text-muted">Loads labeled sample clients, a four-film shoot, an editing hold, and a partially paid invoice into this server. It refuses to run in production and will not overwrite a demo that is already present.</p>
      <Button className="mt-3" variant="ghost" onClick={() => load.mutate()} disabled={load.isPending}>{load.isPending ? "Loading" : "Load demo studio"}</Button>
      {message ? <p className="mt-2 text-sm">{message}</p> : null}
    </section>
  );
}

export function AuditPage() {
  const query = useQuery({ queryKey: ["audit"], queryFn: async () => (await api.get("/audit")).data.data });
  return (
    <div>
      <PageHeader eyebrow="Record" title="Audit log" text="Financial, access, attendance, and ownership changes. Passwords and tokens are not stored here." />
      {query.isLoading ? <LoadingRows /> : (
        <div className="table-wrap"><table className="data"><thead><tr><th>When</th><th>Action</th><th>Entity</th></tr></thead><tbody>
          {(query.data ?? []).map((row: { _id: string; createdAt: string; action: string; entityType: string; entityId: string }) => (
            <tr key={row._id}><td>{new Date(row.createdAt).toLocaleString("en-IN")}</td><td>{row.action}</td><td>{row.entityType} · {row.entityId}</td></tr>
          ))}
        </tbody></table></div>
      )}
    </div>
  );
}

export function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const query = useQuery({ queryKey: ["search", q], queryFn: async () => (await api.get("/search", { params: { q } })).data.data, enabled: q.length >= 2 });
  return (
    <div>
      <PageHeader eyebrow="Find" title={q ? `Results for “${q}”` : "Search"} text="Only records your permissions allow are returned." />
      {query.isLoading ? <LoadingRows /> : null}
      {query.data ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Result title="Clients" rows={(query.data.clients ?? []).map((item: { _id: string; name: string; clientCode: string }) => ({ to: `/clients/${item._id}`, label: `${item.clientCode} ${item.name}` }))} />
          <Result title="Projects" rows={(query.data.projects ?? []).map((item: { _id: string; name: string }) => ({ to: `/projects/${item._id}`, label: item.name }))} />
          <Result title="Deliverables" rows={(query.data.deliverables ?? []).map((item: { _id: string; title: string; deliverableCode: string }) => ({ to: `/deliverables/${item._id}`, label: `${item.deliverableCode} ${item.title}` }))} />
          <Result title="Invoices" rows={(query.data.invoices ?? []).map((item: { _id: string; invoiceNumber: string }) => ({ to: `/invoices/${item._id}`, label: item.invoiceNumber }))} />
        </div>
      ) : <Empty title="Type at least two characters" text="Use the search in the top bar." />}
    </div>
  );
}

function Result({ title, rows }: { title: string; rows: Array<{ to: string; label: string }> }) {
  return <section className="border border-line bg-white"><h2 className="border-b border-line px-4 py-3 font-medium">{title}</h2>{rows.length ? rows.map((row) => <Link key={row.to} className="block border-b border-line px-4 py-3 text-sm" to={row.to}>{row.label}</Link>) : <p className="px-4 py-4 text-sm text-muted">None</p>}</section>;
}

export function NotificationsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["notifications"], queryFn: async () => (await api.get("/notifications")).data.data });
  const read = useMutation({ meta: { silent: true }, mutationFn: async (id: string) => api.post(`/notifications/${id}/read`), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }) });
  return (
    <div>
      <PageHeader eyebrow="Signals" title="Notifications" />
      {(query.data ?? []).map((item: { _id: string; title: string; body?: string; readAt?: string; type?: string }) => (
        <button key={item._id} className={`mb-2 block w-full border border-line bg-white px-4 py-3 text-left ${item.readAt ? "opacity-60" : ""}`} type="button" onClick={() => { read.mutate(item._id); if (item.type === "payslip") navigate("/payroll"); }}>
          <div className="font-medium">{item.title}</div>
          <div className="text-sm text-muted">{item.body}</div>
        </button>
      ))}
      {!query.data?.length && !query.isLoading ? <Empty title="You are caught up" text="Assignments, reviews, and billing events show up here." /> : null}
    </div>
  );
}

const profileSchema = z.object({ name: z.string().min(2) });
const passwordSchema = z.object({ currentPassword: z.string().min(1), nextPassword: z.string().min(8) });

function ProfileFact({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="border-b border-line px-4 py-3">
      <div className="eyebrow">{label}</div>
      <div className="mt-1">{value || "—"}</div>
    </div>
  );
}

export function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const [message, setMessage] = useState("");
  const record = useQuery({
    queryKey: ["employee", user?.employeeId],
    enabled: Boolean(user?.employeeId),
    queryFn: async () => (await api.get(`/employees/${user?.employeeId}`)).data.data as { employee: { employeeCode?: string; designation?: string; phone?: string; email?: string; joiningDate?: string; employmentStatus?: string; emergencyContact?: { name?: string; phone?: string; relation?: string } } },
  });
  const employee = record.data?.employee;
  const contact = [employee?.emergencyContact?.name, employee?.emergencyContact?.relation, employee?.emergencyContact?.phone].filter(Boolean).join(" · ");
  const form = useForm<z.infer<typeof profileSchema>>({ resolver: zodResolver(profileSchema), defaultValues: { name: user?.name ?? "" } });
  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="Account" title={user?.name ?? "Profile"} text={user?.role.name} />
      <section className="mb-6 grid border border-line bg-white sm:grid-cols-2">
        <ProfileFact label="Role" value={user?.role.name} />
        <ProfileFact label="Email" value={user?.email} />
        <ProfileFact label="Employee code" value={employee?.employeeCode} />
        <ProfileFact label="Designation" value={employee?.designation} />
        <ProfileFact label="Phone" value={employee?.phone} />
        <ProfileFact label="Joined" value={employee?.joiningDate} />
        <div className="border-b border-line px-4 py-3">
          <div className="eyebrow">Status</div>
          <div className="mt-2">{employee?.employmentStatus ? <Status value={employee.employmentStatus} /> : "—"}</div>
        </div>
        <ProfileFact label="Emergency contact" value={contact} />
      </section>
      <form className="max-w-md" onSubmit={form.handleSubmit(async (values) => {
        try {
          await withWork("Saving", async () => {
            await api.patch("/auth/profile", values);
            await refreshUser();
            form.reset(values);
            setMessage("");
          }, "Profile saved.");
        } catch (error) { setMessage(errorMessage(error)); }
      })}>
        <Field label="Name"><TextInput {...form.register("name")} /></Field>
        <SaveAction className="mt-4" changed={form.formState.isDirty} stored pending={form.formState.isSubmitting} label="Save" />
        {message ? <p className="mt-3 text-sm text-danger">{message}</p> : null}
        <p className="mt-6 text-sm"><Link to="/password">Change password</Link></p>
      </form>
    </div>
  );
}

export function PasswordPage() {
  const { user, refreshUser } = useAuth();
  const [message, setMessage] = useState("");
  const form = useForm<z.infer<typeof passwordSchema>>({ resolver: zodResolver(passwordSchema) });
  return (
    <div className="grid min-h-screen place-items-center bg-paper px-4">
      <form className="w-full max-w-md border border-line bg-white p-6" onSubmit={form.handleSubmit(async (values) => {
        try {
          await withWork("Updating password", async () => {
            const response = await api.patch("/auth/password", values);
            const { setAccessToken } = await import("@/lib/api");
            setAccessToken(response.data.data.accessToken);
            await refreshUser();
          }, "Password updated.");
          window.location.href = "/";
        } catch (error) { setMessage(errorMessage(error)); }
      })}>
        <div className="font-display text-4xl">Gyroz</div>
        <h1 className="mt-4 text-2xl font-medium">{user?.mustChangePassword ? "Set a new password" : "Change password"}</h1>
        <p className="mt-2 text-sm text-muted">Enter the password you use now, then a new one with at least 8 characters, a letter, and a number.</p>
        <Field label="Current password"><TextInput type="password" autoComplete="current-password" {...form.register("currentPassword")} /></Field>
        <Field label="New password"><TextInput type="password" autoComplete="new-password" {...form.register("nextPassword")} /></Field>
        {message ? <p className="mt-3 text-sm text-danger">{message}</p> : null}
        <SaveAction className="mt-4" changed={form.formState.isDirty} pending={form.formState.isSubmitting} label="Update password" />
        {user && !user.mustChangePassword ? <p className="mt-4 text-sm"><Link to="/">Back to the studio</Link></p> : null}
      </form>
    </div>
  );
}
