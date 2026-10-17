import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { api, errorMessage } from "@/lib/api";
import { PunchRequired, useOpenPunch } from "@/lib/punch";
import { inr, rupeesToPaise } from "@/lib/format";
import { Button, Empty, Field, LoadingRows, PageHeader, SaveAction, Select, Status, TextArea, TextInput, Timeline } from "@/components/ui";
import { useAuth } from "@/lib/auth";

const clientSchema = z.object({
  name: z.string().trim().min(2, "Enter at least 2 characters.").max(80, "Use 80 characters or fewer.").regex(/[A-Za-z]/, "Include letters in the name."),
  kind: z.enum(["company", "individual"]),
  contactPerson: z.string().trim().min(2, "Enter the contact name.").max(60, "Use 60 characters or fewer.").regex(/^[A-Za-z][A-Za-z .'-]*$/, "Use letters for the contact name."),
  phone: z.string().trim().regex(/^\d{10}$/, "Enter a 10-digit phone number."),
  email: z.string().trim().email("Enter a valid email address.").max(120, "Use 120 characters or fewer."),
  billingAddress: z.string().trim().min(5, "Enter the billing address.").max(240, "Use 240 characters or fewer."),
  gstin: z.string().trim().toUpperCase().regex(/^$|^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Enter a 15-character GSTIN, or leave it blank."),
  pricingModel: z.enum(["project", "per_output", "package", "retainer"]),
  notes: z.string().trim().max(500, "Use 500 characters or fewer.").optional(),
  requiresClientApproval: z.boolean().optional(),
});

export function ClientsPage() {
  const { can } = useAuth();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["clients", q], queryFn: async () => (await api.get("/clients", { params: { q } })).data });
  const form = useForm<z.infer<typeof clientSchema>>({ resolver: zodResolver(clientSchema), defaultValues: { name: "", kind: "company", contactPerson: "", phone: "", email: "", billingAddress: "", gstin: "", pricingModel: "project", requiresClientApproval: false } });
  const save = useMutation({
    meta: { loading: "Saving the client", toast: "Client added." },
    mutationFn: async (values: z.infer<typeof clientSchema>) => api.post("/clients", values),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["clients"] }); setOpen(false); form.reset(); setMessage("Client added."); },
    onError: (error) => setMessage(errorMessage(error)),
  });
  const rows = query.data?.data ?? [];
  return (
    <div>
      <PageHeader eyebrow="Ledger" title="Clients" text="Every project, deliverable, and invoice hangs off a client." actions={can("clients.create") ? <Button onClick={() => setOpen((value) => !value)}>New client</Button> : null} />
      <input className="control mb-4 max-w-sm" placeholder="Search name or code" value={q} onChange={(event) => setQ(event.target.value)} aria-label="Search clients" />
      {message ? <p className="mb-3 text-sm">{message}</p> : null}
      {open ? (
        <form className="mb-6 grid gap-3 border border-line bg-white p-4 md:grid-cols-2" onSubmit={form.handleSubmit((values) => save.mutate(values))}>
          <Field label="Name" error={form.formState.errors.name?.message}><TextInput maxLength={80} {...form.register("name")} /></Field>
          <Field label="Kind"><Select {...form.register("kind")}><option value="company">Company</option><option value="individual">Individual</option></Select></Field>
          <Field label="Contact" error={form.formState.errors.contactPerson?.message}><TextInput maxLength={60} {...form.register("contactPerson")} /></Field>
          <Field label="Phone" error={form.formState.errors.phone?.message}><TextInput inputMode="numeric" maxLength={10} placeholder="10 digits" {...form.register("phone")} /></Field>
          <Field label="Email" error={form.formState.errors.email?.message}><TextInput type="email" maxLength={120} placeholder="name@company.com" {...form.register("email")} /></Field>
          <Field label="Pricing model"><Select {...form.register("pricingModel")}><option value="project">Project</option><option value="per_output">Per output</option><option value="package">Package</option><option value="retainer">Retainer</option></Select></Field>
          <Field label="Billing address" error={form.formState.errors.billingAddress?.message}><TextArea maxLength={240} {...form.register("billingAddress")} /></Field>
          <Field label="GSTIN" error={form.formState.errors.gstin?.message}><TextInput maxLength={15} placeholder="15 characters, optional" {...form.register("gstin")} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...form.register("requiresClientApproval")} /> Require client approval before publishing</label>
          <div className="md:col-span-2"><SaveAction changed pending={save.isPending} label="Save client" /></div>
        </form>
      ) : null}
      {query.isLoading ? <LoadingRows /> : rows.length ? (
        <div className="table-wrap"><table className="data"><thead><tr><th>Code</th><th>Name</th><th>Contact</th><th>Model</th><th>Status</th></tr></thead><tbody>
          {rows.map((row: { id: string; clientCode: string; name: string; contactPerson?: string; pricingModel: string; status: string }) => (
            <tr key={row.id}><td className="num">{row.clientCode}</td><td><Link to={`/clients/${row.id}`}>{row.name}</Link></td><td>{row.contactPerson || "—"}</td><td>{row.pricingModel}</td><td><Status value={row.status} /></td></tr>
          ))}
        </tbody></table></div>
      ) : <Empty title="No clients yet" text="Add the first client to open a project." />}
    </div>
  );
}

export function ClientDetailPage() {
  const { id = "" } = useParams();
  const query = useQuery({ queryKey: ["client", id], queryFn: async () => (await api.get(`/clients/${id}`)).data.data });
  if (query.isLoading) return <LoadingRows />;
  if (!query.data) return <Empty title="Client not found" text="This record is missing or outside your assignment." />;
  const { client, projects, deliverables, invoices, outstandingPaise, timeline } = query.data;
  return (
    <div>
      <PageHeader eyebrow={client.clientCode} title={client.name} text={`${client.pricingModel} pricing · ${client.contactPerson || "No contact"}`} />
      <div className="mb-6 grid gap-px bg-line md:grid-cols-4">
        <div className="bg-white p-4"><div className="eyebrow">Status</div><div className="mt-2"><Status value={client.status} /></div></div>
        <div className="bg-white p-4"><div className="eyebrow">Projects</div><div className="num mt-2 text-2xl">{projects.length}</div></div>
        <div className="bg-white p-4"><div className="eyebrow">Deliverables</div><div className="num mt-2 text-2xl">{deliverables.length}</div></div>
        <div className="bg-white p-4"><div className="eyebrow">Outstanding</div><div className="num mt-2 text-2xl">{outstandingPaise == null ? "Restricted" : inr(outstandingPaise)}</div></div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="border border-line bg-white">
          <h2 className="border-b border-line px-4 py-3 font-medium">Projects</h2>
          {projects.map((project: { _id: string; projectCode: string; name: string; status: string }) => (
            <Link key={project._id} to={`/projects/${project._id}`} className="flex items-center justify-between border-b border-line px-4 py-3 text-sm last:border-0"><span>{project.projectCode} · {project.name}</span><Status value={project.status} /></Link>
          ))}
        </section>
        <section className="border border-line bg-white">
          <h2 className="border-b border-line px-4 py-3 font-medium">Activity</h2>
          <Timeline items={(timeline ?? []).map((item: { _id: string; summary: string; createdAt?: string }) => ({ id: item._id, at: item.createdAt, text: item.summary }))} />
        </section>
        {invoices ? (
          <section className="border border-line bg-white lg:col-span-2">
            <h2 className="border-b border-line px-4 py-3 font-medium">Invoices</h2>
            <table className="data"><thead><tr><th>Number</th><th>Status</th><th>Total</th><th>Paid</th></tr></thead><tbody>
              {invoices.map((invoice: { _id: string; invoiceNumber: string; displayStatus?: string; status: string; totalPaise: number; paidPaise: number }) => (
                <tr key={invoice._id}><td><Link to={`/invoices/${invoice._id}`}>{invoice.invoiceNumber}</Link></td><td><Status value={invoice.displayStatus ?? invoice.status} /></td><td className="num">{inr(invoice.totalPaise)}</td><td className="num">{inr(invoice.paidPaise)}</td></tr>
              ))}
            </tbody></table>
          </section>
        ) : null}
      </div>
    </div>
  );
}

const projectSchema = z.object({
  clientId: z.string().min(1, "Choose a client."),
  name: z.string().trim().min(2, "Enter at least 2 characters.").max(80, "Use 80 characters or fewer."),
  description: z.string().trim().max(500, "Use 500 characters or fewer.").optional(),
  serviceType: z.string().trim().max(40, "Use 40 characters or fewer.").optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  budgetRupees: z.string().trim().regex(/^$|^\d+(\.\d{1,2})?$/, "Enter rupees with at most two decimal places.").optional(),
  requiresClientApproval: z.boolean().optional(),
}).refine((values) => !values.startDate || !values.endDate || values.endDate >= values.startDate, { message: "End date must be on or after the start date.", path: ["endDate"] });

export function ProjectsPage() {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const queryClient = useQueryClient();
  const projects = useQuery({ queryKey: ["projects"], queryFn: async () => (await api.get("/projects")).data.data });
  const clients = useQuery({ queryKey: ["clients"], queryFn: async () => (await api.get("/clients")).data.data, enabled: can("clients.view") });
  const form = useForm<z.infer<typeof projectSchema>>({ resolver: zodResolver(projectSchema), defaultValues: { priority: "normal" } });
  const save = useMutation({
    meta: { loading: "Opening the project", toast: "Project opened." },
    mutationFn: async (values: z.infer<typeof projectSchema>) => {
      const budgetPaise = values.budgetRupees?.trim() ? rupeesToPaise(values.budgetRupees) : 0;
      if (budgetPaise == null) throw new Error("Enter the budget in rupees with at most two decimal places.");
      return api.post("/projects", { ...values, budgetPaise });
    },
    onError: (error) => setMessage(error instanceof Error && !("isAxiosError" in error) ? error.message : errorMessage(error)),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["projects"] }); setOpen(false); setMessage("Project opened."); },
  });
  return (
    <div>
      <PageHeader eyebrow="Campaigns" title="Projects" text="A client can hold many projects. Status changes follow the production path." actions={can("projects.create") ? <Button onClick={() => setOpen((v) => !v)}>New project</Button> : null} />
      {message ? <p className="mb-3 text-sm">{message}</p> : null}
      {open ? (
        <form className="mb-6 grid gap-3 border border-line bg-white p-4 md:grid-cols-2" onSubmit={form.handleSubmit((values) => save.mutate(values))}>
          <Field label="Client" error={form.formState.errors.clientId?.message}><Select {...form.register("clientId")}><option value="">Select</option>{(clients.data ?? []).map((client: { id: string; name: string }) => <option key={client.id} value={client.id}>{client.name}</option>)}</Select></Field>
          <Field label="Name" error={form.formState.errors.name?.message}><TextInput maxLength={80} {...form.register("name")} /></Field>
          <Field label="Service" error={form.formState.errors.serviceType?.message}><TextInput maxLength={40} {...form.register("serviceType")} placeholder="Promotional video" /></Field>
          <Field label="Priority"><Select {...form.register("priority")}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></Select></Field>
          <Field label="Start"><TextInput type="date" {...form.register("startDate")} /></Field>
          <Field label="End" error={form.formState.errors.endDate?.message}><TextInput type="date" {...form.register("endDate")} /></Field>
          <Field label="Budget (INR)" error={form.formState.errors.budgetRupees?.message}><TextInput inputMode="decimal" placeholder="0.00" {...form.register("budgetRupees")} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...form.register("requiresClientApproval")} /> Client approval before publishing</label>
          <div className="md:col-span-2"><SaveAction changed pending={save.isPending} label="Create project" /></div>
        </form>
      ) : null}
      {projects.isLoading ? <LoadingRows /> : (projects.data ?? []).length ? (
        <div className="table-wrap"><table className="data"><thead><tr><th>Code</th><th>Project</th><th>Priority</th><th>Status</th></tr></thead><tbody>
          {(projects.data ?? []).map((project: { _id: string; projectCode: string; name: string; priority: string; status: string }) => (
            <tr key={project._id}><td className="num">{project.projectCode}</td><td><Link to={`/projects/${project._id}`}>{project.name}</Link></td><td>{project.priority}</td><td><Status value={project.status} /></td></tr>
          ))}
        </tbody></table></div>
      ) : <Empty title="No projects" text="Open a project against a client to schedule a shoot." />}
    </div>
  );
}

export function ProjectDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["project", id], queryFn: async () => (await api.get(`/projects/${id}`)).data.data });
  const move = useMutation({
    meta: { loading: "Updating the project", toast: (_data: unknown, status: string) => `Moved to ${status.replaceAll("_", " ")}.` },
    mutationFn: async (status: string) => api.post(`/projects/${id}/transition`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project", id] }),
  });
  if (query.isLoading) return <LoadingRows />;
  if (!query.data) return <Empty title="Project not found" text="It may have been removed from your assignment." />;
  const { project, deliverables, allowedTransitions, timeline } = query.data;
  const counts = deliverables.reduce((acc: Record<string, number>, item: { status: string }) => ({ ...acc, [item.status]: (acc[item.status] ?? 0) + 1 }), {});
  return (
    <div>
      <PageHeader eyebrow={project.projectCode} title={project.name} text={project.description || project.serviceType} actions={<Button variant="ghost" onClick={() => navigate("/shoots")}>Schedule a shoot</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Status value={project.status} />
        {allowedTransitions.map((status: string) => <Button key={status} size="sm" variant="ghost" onClick={() => move.mutate(status)}>Move to {status.replaceAll("_", " ")}</Button>)}
      </div>
      {move.isError ? <p className="mb-3 text-sm text-danger">{errorMessage(move.error)}</p> : null}
      <div className="mb-6 flex flex-wrap gap-2 text-sm">{Object.entries(counts).map(([status, count]) => <span key={status} className="border border-line bg-white px-2 py-1">{String(count)} {status.replaceAll("_", " ")}</span>)}</div>
      <div className="table-wrap mb-6"><table className="data"><thead><tr><th>Deliverable</th><th>Deadline</th><th>Revision</th><th>Status</th></tr></thead><tbody>
        {deliverables.map((item: { _id: string; deliverableCode: string; title: string; deadline?: string; revisionCount: number; status: string }) => (
          <tr key={item._id}><td><Link to={`/deliverables/${item._id}`}>{item.deliverableCode} · {item.title}</Link></td><td>{item.deadline || "—"}</td><td className="num">{item.revisionCount}</td><td><Status value={item.status} /></td></tr>
        ))}
      </tbody></table></div>
      <section className="border border-line bg-white">
        <h2 className="border-b border-line px-4 py-3 font-medium">Timeline</h2>
        <Timeline items={(timeline ?? []).map((item: { _id: string; summary: string; createdAt?: string }) => ({ id: item._id, at: item.createdAt, text: item.summary }))} />
      </section>
    </div>
  );
}

const shootSchema = z.object({
  projectId: z.string().min(1, "Choose a project."),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
  location: z.string().trim().min(2, "Enter the location.").max(120, "Use 120 characters or fewer."),
  cinematographerId: z.string().min(1, "Choose a cinematographer."),
  plannedOutputCount: z.coerce.number().int().min(1, "Plan at least 1 output.").max(20, "Plan at most 20 outputs."),
  brief: z.string().trim().max(500, "Use 500 characters or fewer.").optional(),
});

export function ShootsPage() {
  const { can } = useAuth();
  const punch = useOpenPunch();
  const mineOnly = can("shoots.log") && !can("shoots.create");
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const queryClient = useQueryClient();
  const shoots = useQuery({ queryKey: ["shoots", mineOnly], queryFn: async () => (await api.get("/shoots", { params: { limit: 50, ...(mineOnly ? { mine: "1" } : {}) } })).data.data });
  const projects = useQuery({ queryKey: ["projects"], queryFn: async () => (await api.get("/projects")).data.data, enabled: can("shoots.create") });
  const people = useQuery({ queryKey: ["employees", "camera"], queryFn: async () => (await api.get("/employees", { params: { assign: "camera", status: "active", limit: 100 } })).data.data, enabled: can("employees.view") });
  const form = useForm<z.infer<typeof shootSchema>>({ resolver: zodResolver(shootSchema), defaultValues: { projectId: "", scheduledDate: "", location: "", cinematographerId: "", brief: "", plannedOutputCount: 1 } });
  const save = useMutation({
    meta: { loading: "Saving the shoot", toast: "Shoot scheduled." },
    mutationFn: async (values: z.infer<typeof shootSchema>) => {
      const project = (projects.data ?? []).find((item: { _id: string; clientId: string }) => item._id === values.projectId);
      return api.post("/shoots", { ...values, clientId: project?.clientId, plannedOutputCount: Number(values.plannedOutputCount) });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["shoots"] }); setOpen(false); setMessage("Shoot scheduled."); },
    onError: (error) => setMessage(errorMessage(error)),
  });
  return (
    <div>
      <PageHeader eyebrow="Floor" title={mineOnly ? "Your shoots" : "Shoots"} text={mineOnly ? "An admin assigns the shoot. After you punch in, you log where you went, how long it took, what happened, and any money spent. Punching out locks the report." : "Schedule the shoot for a cinematographer. They log the field report only while they are punched in."} actions={can("shoots.create") ? <Button onClick={() => setOpen((v) => !v)}>Schedule shoot</Button> : null} />
      {mineOnly ? <PunchRequired /> : null}
      {message ? <p className="mb-3 text-sm">{message}</p> : null}
      {open ? (
        <form className="mb-6 grid gap-3 border border-line bg-white p-4 md:grid-cols-2" onSubmit={form.handleSubmit((values) => save.mutate(values))}>
          <Field label="Project" error={form.formState.errors.projectId?.message}><Select {...form.register("projectId")}><option value="">Select</option>{(projects.data ?? []).map((project: { _id: string; name: string }) => <option key={project._id} value={project._id}>{project.name}</option>)}</Select></Field>
          <Field label="Date" error={form.formState.errors.scheduledDate?.message}><TextInput type="date" {...form.register("scheduledDate")} /></Field>
          <Field label="Location" error={form.formState.errors.location?.message}><TextInput maxLength={120} {...form.register("location")} /></Field>
          <Field label="Cinematographer" error={form.formState.errors.cinematographerId?.message}><Select {...form.register("cinematographerId")}><option value="">Select</option>{(people.data ?? []).map((person: { _id: string; firstName: string; lastName: string }) => <option key={person._id} value={person._id}>{person.firstName} {person.lastName}</option>)}</Select>{(people.data ?? []).length ? null : <p className="mt-1 text-xs text-muted">No cinematographer is on the roster.</p>}</Field>
          <Field label="Planned outputs" error={form.formState.errors.plannedOutputCount?.message}><TextInput type="number" min={1} max={20} {...form.register("plannedOutputCount")} /></Field>
          <Field label="Brief" error={form.formState.errors.brief?.message}><TextArea maxLength={500} {...form.register("brief")} /></Field>
          <div className="md:col-span-2"><SaveAction changed pending={save.isPending} label="Save shoot" /></div>
        </form>
      ) : null}
      {mineOnly ? (
        <div className="space-y-4">
          {(shoots.data ?? []).length ? (shoots.data ?? []).map((shoot: FieldShoot) => <FieldReport key={shoot._id} shoot={shoot} locked={!punch.open} />) : <Empty title="No shoot is assigned to you" text="When an admin puts you on a shoot, it appears here. The report opens after you punch in." />}
        </div>
      ) : (
      <div className="table-wrap"><table className="data"><thead><tr><th>Code</th><th>Client</th><th>When</th><th>Location</th><th>Status</th><th></th></tr></thead><tbody>
        {(shoots.data ?? []).map((shoot: { _id: string; shootCode: string; clientName?: string; projectName?: string; scheduledDate: string; plannedStart?: string; plannedEnd?: string; location?: string; status: string; hoursSpent?: number; reshootCode?: string; reshootTitle?: string }) => (
          <tr key={shoot._id}>
            <td className="num">{shoot.shootCode}{shoot.reshootCode ? ` · reshoot` : ""}<div className="text-xs text-muted">{shoot.reshootTitle || shoot.projectName}</div></td>
            <td>{shoot.clientName || "—"}</td>
            <td>{shoot.scheduledDate}<div className="text-xs text-muted">{shoot.plannedStart || "—"}–{shoot.plannedEnd || "—"}</div></td>
            <td>{shoot.location || "—"}</td>
            <td><Status value={shoot.status} /></td>
            <td className="text-xs text-muted">{shoot.hoursSpent ? `${shoot.hoursSpent}h logged` : "Waiting on the camera report"}</td>
          </tr>
        ))}
      </tbody></table></div>
      )}
    </div>
  );
}

type FieldExpense = { category: string; description: string; amountPaise: number; status: string };
type FieldShoot = {
  _id: string;
  shootCode: string;
  clientName?: string;
  projectName?: string;
  scheduledDate: string;
  plannedStart?: string;
  plannedEnd?: string;
  location?: string;
  status: string;
  hoursSpent?: number;
  report?: string;
  reshootRequestId?: string;
  reshootCode?: string;
  reshootTitle?: string;
  expenses?: FieldExpense[];
};

function FieldReport({ shoot, locked }: { shoot: FieldShoot; locked: boolean }) {
  const queryClient = useQueryClient();
  const [location, setLocation] = useState(shoot.location ?? "");
  const [hours, setHours] = useState(shoot.hoursSpent ? String(shoot.hoursSpent) : "");
  const [report, setReport] = useState(shoot.report ?? "");
  const [expenses, setExpenses] = useState<Array<{ category: string; description: string; amount: string }>>([]);
  const [outputs, setOutputs] = useState("Cut 1");
  const [handOff, setHandOff] = useState(false);
  const [message, setMessage] = useState("");
  const [reportDirty, setReportDirty] = useState(false);
  const [reportKept, setReportKept] = useState(Boolean(shoot.report));
  const open = shoot.status === "scheduled" || shoot.status === "in_progress";
  const reshoot = Boolean(shoot.reshootRequestId);
  const save = useMutation({
    meta: { loading: "Saving the report", toast: "Report saved." },
    mutationFn: async () => {
      const hoursSpent = Number(hours);
      if (location.trim().length < 2 || location.trim().length > 120) throw new Error("Enter the location, up to 120 characters.");
      if (!(hoursSpent > 0) || hoursSpent > 48) throw new Error("Enter how many hours the shoot took, up to 48.");
      if (report.trim().length < 2) throw new Error("Write what happened on the shoot.");
      const filed = expenses.filter((item) => item.description.trim() || item.amount.trim()).map((item) => {
        const amountPaise = rupeesToPaise(item.amount);
        if (item.description.trim().length < 2 || amountPaise == null || amountPaise <= 0) throw new Error("Each expense needs a short description and an amount in rupees.");
        return { category: item.category, description: item.description.trim(), amountPaise };
      });
      return api.post(`/shoots/${shoot._id}/report`, { location: location.trim(), hoursSpent, report: report.trim(), expenses: filed });
    },
    onSuccess: () => { setExpenses([]); setReportDirty(false); setReportKept(true); setMessage(""); queryClient.invalidateQueries({ queryKey: ["shoots"] }); },
    onError: (error) => setMessage(error instanceof Error && !("isAxiosError" in error) ? error.message : errorMessage(error)),
  });
  const submit = useMutation({
    meta: { loading: "Sending to editors", toast: "Sent to editors." },
    mutationFn: async () => api.post(`/shoots/${shoot._id}/submit`, reshoot ? {
      usableFootageCount: 1,
      notes: report.trim(),
    } : {
      usableFootageCount: outputs.split("\n").map((title) => title.trim()).filter(Boolean).length,
      notes: report.trim(),
      outputs: outputs.split("\n").map((title) => title.trim()).filter(Boolean).map((title) => ({ title, type: "promotional_video" })),
    }),
    onSuccess: () => { setHandOff(false); setMessage("Handed to editing."); queryClient.invalidateQueries({ queryKey: ["shoots"] }); },
    onError: (error) => setMessage(errorMessage(error)),
  });
  return (
    <section className="border border-line bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.12em] text-muted">{shoot.shootCode}{shoot.reshootCode ? ` · ${shoot.reshootCode}` : ""} · {shoot.scheduledDate} · {shoot.plannedStart || "—"}–{shoot.plannedEnd || "—"}</div>
          <h2 className="mt-1 font-medium">{shoot.clientName || "Client"} · {shoot.projectName || "Project"}</h2>
          {reshoot ? <p className="mt-1 text-sm text-muted">Reshoot{shoot.reshootTitle ? ` of ${shoot.reshootTitle}` : ""}. Log where you went and what you re-shot. Sending it back puts the same video into editing again.</p> : null}
        </div>
        <Status value={shoot.status} />
      </div>
      {open && locked ? <p className="mt-3 text-sm text-muted">This shoot is assigned to you. The report stays closed until you are punched in.</p> : null}
      {open && !locked ? (
        <form className="mt-4 grid gap-3 md:grid-cols-2" onChange={() => setReportDirty(true)} onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
          <Field label="Location you went"><TextInput maxLength={120} value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Where the shoot happened" /></Field>
          <Field label="Hours it took"><TextInput inputMode="decimal" value={hours} onChange={(event) => setHours(event.target.value)} placeholder="6.5" /></Field>
          <div className="md:col-span-2"><Field label="Report"><TextArea maxLength={500} value={report} onChange={(event) => setReport(event.target.value)} placeholder={reshoot ? "What you re-shot, what is usable, and anything that blocked you." : "What was shot, what is usable, and anything that blocked you."} /></Field></div>
          <div className="md:col-span-2 space-y-2">
            <div className="text-sm font-medium">Expenses on this shoot</div>
            {expenses.map((item, index) => (
              <div key={index} className="grid gap-2 md:grid-cols-[160px_1fr_140px]">
                <Select value={item.category} onChange={(event) => setExpenses(expenses.map((row, rowIndex) => rowIndex === index ? { ...row, category: event.target.value } : row))} aria-label="Expense category">
                  <option value="travel">Travel</option>
                  <option value="food">Food</option>
                  <option value="equipment">Equipment</option>
                  <option value="production">Production</option>
                  <option value="other">Other</option>
                </Select>
                <TextInput maxLength={160} value={item.description} onChange={(event) => setExpenses(expenses.map((row, rowIndex) => rowIndex === index ? { ...row, description: event.target.value } : row))} placeholder="What you paid for" aria-label="Expense description" />
                <TextInput inputMode="decimal" value={item.amount} onChange={(event) => setExpenses(expenses.map((row, rowIndex) => rowIndex === index ? { ...row, amount: event.target.value } : row))} placeholder="Amount INR" aria-label="Expense amount" />
              </div>
            ))}
            <Button type="button" variant="ghost" onClick={() => setExpenses([...expenses, { category: "travel", description: "", amount: "" }])}>Add an expense</Button>
          </div>
          <div className="flex flex-wrap gap-2 md:col-span-2">
            <SaveAction changed={reportDirty} stored={reportKept} pending={save.isPending} label="Save report" />
            <Button type="button" variant="ghost" onClick={() => { if (!shoot.report) { setMessage("Save the report before handing the footage to editing."); return; } if (reshoot) { submit.mutate(); return; } setHandOff(true); }}>{reshoot ? "Send rework to editing" : "Hand to editing"}</Button>
          </div>
        </form>
      ) : <p className="mt-3 text-sm text-muted">{shoot.hoursSpent ? `${shoot.hoursSpent}h` : "Time not logged"}{shoot.location ? ` · ${shoot.location}` : ""}. {shoot.report || "No report."}</p>}
      {(shoot.expenses ?? []).length ? <ul className="mt-3 divide-y divide-line border border-line text-sm">{shoot.expenses?.map((item, index) => <li key={index} className="flex justify-between gap-3 px-3 py-2"><span>{item.category} · {item.description}</span><span>{inr(item.amountPaise)} · {item.status}</span></li>)}</ul> : null}
      {handOff ? <form className="mt-3" onSubmit={(event) => { event.preventDefault(); submit.mutate(); }}><Field label="Cuts to send"><TextArea value={outputs} onChange={(event) => setOutputs(event.target.value)} /></Field><SaveAction className="mt-2" changed pending={submit.isPending} label="Send to editors" /></form> : null}
      {message ? <p className="mt-3 text-sm">{message}</p> : null}
    </section>
  );
}

