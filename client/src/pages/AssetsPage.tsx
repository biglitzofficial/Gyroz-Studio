import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { inr, paiseToRupees, rupeesToPaise, titleCase, todayKey } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { Button, Empty, Field, LoadingRows, Notice, PageHeader, Select, Status, TextArea, TextInput } from "@/components/ui";

const CATEGORIES = [
  ["camera", "Camera"],
  ["lens", "Lens"],
  ["lighting", "Lighting"],
  ["audio", "Audio"],
  ["drone", "Drone"],
  ["grip", "Grip"],
  ["computer", "Computer"],
  ["storage", "Storage"],
  ["power", "Power"],
  ["vehicle", "Vehicle"],
  ["other", "Other"],
] as const;

const CONDITIONS = [["new", "New"], ["good", "Good"], ["fair", "Fair"], ["poor", "Poor"]] as const;
const STATUSES = [["", "All statuses"], ["available", "Available"], ["assigned", "With staff"], ["in_repair", "In repair"], ["damaged", "Damaged"], ["retired", "Retired"], ["lost", "Lost"]] as const;

type Summary = { total: number; available: number; assigned: number; inRepair: number; damaged: number; purchasePaise: number; repairPaise: number; servicePaise: number };
type AssetRow = {
  _id: string;
  assetCode: string;
  name: string;
  category: string;
  brand?: string;
  modelName?: string;
  serialNumber?: string;
  status: string;
  condition: string;
  location?: string;
  holderName?: string;
  purchasePaise?: number;
  repairPaise?: number;
  servicePaise?: number;
};
type AssetEvent = { kind: string; dateKey: string; note?: string; costPaise?: number; holderName?: string; recordedAt?: string };
type Asset = AssetRow & {
  purchaseDate?: string;
  vendor?: string;
  warrantyUntil?: string;
  notes?: string;
  events?: AssetEvent[];
};

const EVENT_LABEL: Record<string, string> = {
  added: "Added",
  assigned: "Handed out",
  returned: "Returned",
  damaged: "Damaged",
  repair_sent: "Sent for repair",
  repair_done: "Repair finished",
  service: "Serviced",
  retired: "Retired",
  lost: "Marked lost",
  note: "Note",
};

function moneyField(value: string) {
  const amount = rupeesToPaise(value || "0");
  if (amount == null) return null;
  return amount;
}

export function AssetsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", category: "camera", brand: "", modelName: "", serialNumber: "", condition: "good", location: "", purchaseDate: "", purchase: "", vendor: "", warrantyUntil: "", notes: "" });
  const [message, setMessage] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setQ(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const query = useQuery({
    queryKey: ["assets", page, category, status, q],
    queryFn: async () => (await api.get("/assets", { params: { page, limit: 20, ...(category ? { category } : {}), ...(status ? { status } : {}), ...(q ? { q } : {}) } })).data.data as { items: AssetRow[]; total: number; page: number; pageSize: number; summary: Summary },
  });
  const create = useMutation({
    meta: { loading: "Adding the item", toast: "Item added." },
    mutationFn: async () => {
      const purchasePaise = moneyField(form.purchase);
      if (purchasePaise == null) throw new Error("Enter the purchase cost in rupees, or 0.");
      if (form.name.trim().length < 2) throw new Error("Name the item.");
      return api.post("/assets", {
        name: form.name.trim(),
        category: form.category,
        brand: form.brand.trim(),
        modelName: form.modelName.trim(),
        serialNumber: form.serialNumber.trim(),
        condition: form.condition,
        location: form.location.trim(),
        purchaseDate: form.purchaseDate || undefined,
        purchasePaise,
        vendor: form.vendor.trim(),
        warrantyUntil: form.warrantyUntil || undefined,
        notes: form.notes.trim(),
      });
    },
    onSuccess: (result) => {
      setOpen(false);
      setForm({ name: "", category: "camera", brand: "", modelName: "", serialNumber: "", condition: "good", location: "", purchaseDate: "", purchase: "", vendor: "", warrantyUntil: "", notes: "" });
      setMessage("");
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
      navigate(`/assets/${result.data.data._id}`);
    },
    onError: (error) => setMessage(error instanceof Error && !("isAxiosError" in error) ? error.message : errorMessage(error)),
  });
  const data = query.data;
  const summary = data?.summary;
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 20;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <div>
      <PageHeader eyebrow="Kit" title="Assets" text="Cameras, lenses, lights, and every other studio item. Damage, repairs, and service costs stay on the item." actions={<Button onClick={() => setOpen((value) => !value)}>{open ? "Close" : "Add item"}</Button>} />
      {summary ? (
        <div className="mb-4 grid grid-cols-2 border border-line bg-white md:grid-cols-4 xl:grid-cols-8">
          {[
            ["Items", String(summary.total)],
            ["Available", String(summary.available)],
            ["With staff", String(summary.assigned)],
            ["In repair", String(summary.inRepair)],
            ["Damaged", String(summary.damaged)],
            ["Purchase", inr(summary.purchasePaise)],
            ["Repairs", inr(summary.repairPaise)],
            ["Service", inr(summary.servicePaise)],
          ].map(([label, value]) => (
            <div key={label} className="border-b border-r border-line px-3 py-3">
              <div className="text-xs text-muted">{label}</div>
              <div className="num mt-1 text-lg">{value}</div>
            </div>
          ))}
        </div>
      ) : null}
      {open ? (
        <form className="mb-4 grid gap-3 border border-line bg-white p-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
          <Field label="Name"><TextInput value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></Field>
          <Field label="Category"><Select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>{CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
          <Field label="Brand"><TextInput value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} /></Field>
          <Field label="Model"><TextInput value={form.modelName} onChange={(event) => setForm({ ...form, modelName: event.target.value })} /></Field>
          <Field label="Serial number"><TextInput value={form.serialNumber} onChange={(event) => setForm({ ...form, serialNumber: event.target.value })} /></Field>
          <Field label="Condition"><Select value={form.condition} onChange={(event) => setForm({ ...form, condition: event.target.value })}>{CONDITIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
          <Field label="Where it is kept"><TextInput value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></Field>
          <Field label="Vendor"><TextInput value={form.vendor} onChange={(event) => setForm({ ...form, vendor: event.target.value })} /></Field>
          <Field label="Purchase date"><TextInput type="date" value={form.purchaseDate} onChange={(event) => setForm({ ...form, purchaseDate: event.target.value })} /></Field>
          <Field label="Purchase cost (INR)"><TextInput inputMode="decimal" value={form.purchase} onChange={(event) => setForm({ ...form, purchase: event.target.value })} placeholder="0" /></Field>
          <Field label="Warranty until"><TextInput type="date" value={form.warrantyUntil} onChange={(event) => setForm({ ...form, warrantyUntil: event.target.value })} /></Field>
          <Field label="Notes"><TextArea maxLength={500} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>
          <div className="md:col-span-2 flex gap-2"><Button type="submit" disabled={create.isPending}>{create.isPending ? "Saving" : "Save item"}</Button></div>
          {message ? <p className="text-sm text-danger md:col-span-2">{message}</p> : null}
        </form>
      ) : null}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <TextInput className="w-full sm:w-64" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search name, serial, or code" aria-label="Search assets" />
        <div className="w-full sm:w-40"><Select aria-label="Category" value={category} onChange={(event) => { setCategory(event.target.value); setPage(1); }}><option value="">All categories</option>{CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></div>
        <div className="w-full sm:w-40"><Select aria-label="Status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>{STATUSES.map(([value, label]) => <option key={value || "all"} value={value}>{label}</option>)}</Select></div>
      </div>
      {query.isLoading ? <LoadingRows /> : query.isError ? <Notice tone="danger">{errorMessage(query.error)}</Notice> : data?.items.length ? (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Item</th><th>Category</th><th>Status</th><th>Holder</th><th>Kept at</th><th>Repairs</th><th>Service</th></tr></thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item._id}>
                    <td data-label="Item"><Link className="font-medium" to={`/assets/${item._id}`}>{item.name}</Link><div className="text-xs text-muted">{item.assetCode}{item.serialNumber ? ` · ${item.serialNumber}` : ""}</div></td>
                    <td data-label="Category">{titleCase(item.category)}{item.brand || item.modelName ? <div className="text-xs text-muted">{[item.brand, item.modelName].filter(Boolean).join(" ")}</div> : null}</td>
                    <td data-label="Status"><Status value={item.status} /></td>
                    <td data-label="Holder">{item.holderName || "—"}</td>
                    <td data-label="Kept at">{item.location || "—"}</td>
                    <td data-label="Repairs" className="num">{inr(item.repairPaise)}</td>
                    <td data-label="Service" className="num">{inr(item.servicePaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
            <span>{from}–{to} of {total}</span>
            <span className="flex gap-2">
              <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
              <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage((current) => current + 1)}>Next</Button>
            </span>
          </div>
        </>
      ) : <Empty title={summary?.total ? "Nothing matches this filter" : "No studio items yet"} text={summary?.total ? "Clear the search or choose another filter." : "Add a camera, lens, light, or anything else the studio owns."} />}
    </div>
  );
}

const ACTIONS: Record<string, Array<[string, string]>> = {
  available: [["assigned", "Hand out"], ["damaged", "Mark damaged"], ["repair_sent", "Send for repair"], ["service", "Log service"], ["retired", "Retire"], ["lost", "Mark lost"], ["note", "Add note"]],
  assigned: [["returned", "Returned"], ["damaged", "Mark damaged"], ["repair_sent", "Send for repair"], ["service", "Log service"], ["retired", "Retire"], ["lost", "Mark lost"], ["note", "Add note"]],
  damaged: [["returned", "Returned"], ["repair_sent", "Send for repair"], ["service", "Log service"], ["retired", "Retire"], ["lost", "Mark lost"], ["note", "Add note"]],
  in_repair: [["repair_done", "Repair finished"], ["damaged", "Add damage note"], ["retired", "Retire"], ["lost", "Mark lost"], ["note", "Add note"]],
  retired: [["note", "Add note"]],
  lost: [["note", "Add note"]],
};

export function AssetDetailPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");
  const query = useQuery({ queryKey: ["asset", id], queryFn: async () => (await api.get(`/assets/${id}`)).data.data as Asset });
  const asset = query.data;
  return (
    <div>
      <PageHeader eyebrow={asset?.assetCode || "Asset"} title={asset?.name || "Asset"} text={asset ? [titleCase(asset.category), asset.brand, asset.modelName].filter(Boolean).join(" · ") : ""} actions={<Link className="text-sm" to="/assets">All assets</Link>} />
      {query.isLoading ? <LoadingRows /> : query.isError ? <Notice tone="danger">{errorMessage(query.error)}</Notice> : asset ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            <section className="border border-line bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
                <div className="flex items-center gap-2"><Status value={asset.status} /><Status value={asset.condition} /></div>
                <Button size="sm" variant="ghost" onClick={() => setEditing((value) => !value)}>{editing ? "Close" : "Edit details"}</Button>
              </div>
              {editing ? <EditAsset asset={asset} onSaved={() => { setEditing(false); setMessage(""); void queryClient.invalidateQueries({ queryKey: ["asset", id] }); void queryClient.invalidateQueries({ queryKey: ["assets"] }); }} /> : (
                <dl className="grid sm:grid-cols-2">
                  <Fact label="Serial" value={asset.serialNumber} />
                  <Fact label="Kept at" value={asset.location} />
                  <Fact label="Holder" value={asset.holderName} />
                  <Fact label="Vendor" value={asset.vendor} />
                  <Fact label="Purchased" value={asset.purchaseDate} />
                  <Fact label="Purchase cost" value={inr(asset.purchasePaise)} />
                  <Fact label="Warranty until" value={asset.warrantyUntil} />
                  <Fact label="Repair spend" value={inr(asset.repairPaise)} />
                  <Fact label="Service spend" value={inr(asset.servicePaise)} />
                  <Fact label="Notes" value={asset.notes} />
                </dl>
              )}
            </section>
            <section className="mt-4 border border-line bg-white">
              <h2 className="border-b border-line px-4 py-3 font-medium">History</h2>
              {(asset.events ?? []).length ? (
                <ol>
                  {(asset.events ?? []).map((event, index) => (
                    <li key={`${event.recordedAt ?? event.dateKey}-${index}`} className="grid gap-1 border-b border-line px-4 py-3 text-sm last:border-0 sm:grid-cols-[140px_minmax(0,1fr)]">
                      <div>
                        <div className="font-medium">{EVENT_LABEL[event.kind] || titleCase(event.kind)}</div>
                        <div className="text-xs text-muted">{event.dateKey}</div>
                      </div>
                      <div>
                        <div>{event.note || "—"}</div>
                        <div className="text-xs text-muted">{[event.holderName, event.costPaise ? inr(event.costPaise) : ""].filter(Boolean).join(" · ")}</div>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : <p className="px-4 py-6 text-sm text-muted">Nothing recorded yet.</p>}
            </section>
          </div>
          <EventForm asset={asset} zone={user?.studio?.businessTimezone} onError={setMessage} message={message} onSaved={() => { setMessage(""); void queryClient.invalidateQueries({ queryKey: ["asset", id] }); void queryClient.invalidateQueries({ queryKey: ["assets"] }); }} />
        </div>
      ) : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value?: string | null }) {
  return <div className="border-b border-line px-4 py-3"><div className="eyebrow">{label}</div><div className="mt-1">{value || "—"}</div></div>;
}

function EditAsset({ asset, onSaved }: { asset: Asset; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: asset.name,
    category: asset.category,
    brand: asset.brand || "",
    modelName: asset.modelName || "",
    serialNumber: asset.serialNumber || "",
    condition: asset.condition,
    location: asset.location || "",
    purchaseDate: asset.purchaseDate || "",
    purchase: paiseToRupees(asset.purchasePaise) || "0",
    vendor: asset.vendor || "",
    warrantyUntil: asset.warrantyUntil || "",
    notes: asset.notes || "",
  });
  const [message, setMessage] = useState("");
  const save = useMutation({
    meta: { loading: "Saving the item", toast: "Item saved." },
    mutationFn: async () => {
      const purchasePaise = moneyField(form.purchase);
      if (purchasePaise == null) throw new Error("Enter the purchase cost in rupees, or 0.");
      return api.patch(`/assets/${asset._id}`, { ...form, name: form.name.trim(), purchasePaise, purchaseDate: form.purchaseDate || undefined, warrantyUntil: form.warrantyUntil || undefined });
    },
    onSuccess: onSaved,
    onError: (error) => setMessage(error instanceof Error && !("isAxiosError" in error) ? error.message : errorMessage(error)),
  });
  return (
    <form className="grid gap-3 p-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <Field label="Name"><TextInput value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></Field>
      <Field label="Category"><Select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>{CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
      <Field label="Brand"><TextInput value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} /></Field>
      <Field label="Model"><TextInput value={form.modelName} onChange={(event) => setForm({ ...form, modelName: event.target.value })} /></Field>
      <Field label="Serial number"><TextInput value={form.serialNumber} onChange={(event) => setForm({ ...form, serialNumber: event.target.value })} /></Field>
      <Field label="Condition"><Select value={form.condition} onChange={(event) => setForm({ ...form, condition: event.target.value })}>{CONDITIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
      <Field label="Where it is kept"><TextInput value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></Field>
      <Field label="Vendor"><TextInput value={form.vendor} onChange={(event) => setForm({ ...form, vendor: event.target.value })} /></Field>
      <Field label="Purchase date"><TextInput type="date" value={form.purchaseDate} onChange={(event) => setForm({ ...form, purchaseDate: event.target.value })} /></Field>
      <Field label="Purchase cost (INR)"><TextInput inputMode="decimal" value={form.purchase} onChange={(event) => setForm({ ...form, purchase: event.target.value })} /></Field>
      <Field label="Warranty until"><TextInput type="date" value={form.warrantyUntil} onChange={(event) => setForm({ ...form, warrantyUntil: event.target.value })} /></Field>
      <Field label="Notes"><TextArea maxLength={500} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>
      <div className="sm:col-span-2"><Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving" : "Save details"}</Button></div>
      {message ? <p className="text-sm text-danger sm:col-span-2">{message}</p> : null}
    </form>
  );
}

function EventForm({ asset, zone, message, onError, onSaved }: { asset: Asset; zone?: string; message: string; onError: (value: string) => void; onSaved: () => void }) {
  const choices = ACTIONS[asset.status] ?? ACTIONS.available;
  const showReturn = choices.some(([kind]) => kind === "returned") && (asset.status === "assigned" || Boolean(asset.holderName));
  const visible = choices.filter(([kind]) => kind !== "returned" || showReturn);
  const [kind, setKind] = useState(visible[0]?.[0] ?? "note");
  useEffect(() => { setKind(visible[0]?.[0] ?? "note"); }, [asset.status, asset.holderName]);
  const [dateKey, setDateKey] = useState(todayKey(zone ?? "Asia/Kolkata"));
  const [note, setNote] = useState("");
  const [cost, setCost] = useState("");
  const [holderEmployeeId, setHolderEmployeeId] = useState("");
  const [condition, setCondition] = useState(asset.condition);
  const people = useQuery({
    queryKey: ["employees", "assets"],
    enabled: kind === "assigned",
    queryFn: async () => (await api.get("/employees", { params: { status: "active", limit: 100 } })).data.data as Array<{ _id?: string; id?: string; firstName: string; lastName: string; employeeCode?: string }>,
  });
  const save = useMutation({
    meta: { loading: "Saving the record", toast: "Record saved." },
    mutationFn: async () => {
      const needsCost = kind === "repair_done" || kind === "service";
      const costPaise = needsCost ? moneyField(cost || "0") : 0;
      if (costPaise == null) throw new Error("Enter the cost in rupees, or 0.");
      return api.post(`/assets/${asset._id}/events`, {
        kind,
        dateKey,
        note: note.trim(),
        costPaise: costPaise || undefined,
        holderEmployeeId: kind === "assigned" ? holderEmployeeId : undefined,
        condition: kind === "repair_done" || kind === "service" ? condition : undefined,
      });
    },
    onSuccess: () => {
      setNote("");
      setCost("");
      onSaved();
    },
    onError: (error) => onError(error instanceof Error && !("isAxiosError" in error) ? error.message : errorMessage(error)),
  });
  const prompt = kind === "assigned" ? "Who has it" : kind === "damaged" ? "What is damaged" : kind === "repair_sent" ? "Shop or fault" : kind === "repair_done" ? "What was repaired" : kind === "service" ? "What was serviced" : kind === "retired" ? "Why it is leaving" : kind === "lost" ? "What happened" : "Note";
  return (
    <form className="border border-line bg-white p-4" onSubmit={(event) => { event.preventDefault(); onError(""); save.mutate(); }}>
      <h2 className="font-medium">Record</h2>
      <p className="mt-1 mb-3 text-sm text-muted">Each save stays on this item. Repair and service costs add to the totals.</p>
      <Field label="What happened">
        <Select value={kind} onChange={(event) => setKind(event.target.value)}>
          {visible.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
      </Field>
      <Field label="Date"><TextInput type="date" value={dateKey} onChange={(event) => setDateKey(event.target.value)} required /></Field>
      {kind === "assigned" ? (
        <Field label="Person">
          <Select value={holderEmployeeId} onChange={(event) => setHolderEmployeeId(event.target.value)} required>
            <option value="">Select</option>
            {(people.data ?? []).map((person) => <option key={String(person._id || person.id)} value={String(person._id || person.id)}>{person.employeeCode ? `${person.employeeCode} · ` : ""}{person.firstName} {person.lastName}</option>)}
          </Select>
        </Field>
      ) : null}
      <Field label={prompt}><TextArea maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} /></Field>
      {kind === "repair_done" || kind === "service" ? (
        <>
          <Field label="Cost (INR)"><TextInput inputMode="decimal" value={cost} onChange={(event) => setCost(event.target.value)} placeholder="0" /></Field>
          <Field label="Condition after"><Select value={condition} onChange={(event) => setCondition(event.target.value)}>{CONDITIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
        </>
      ) : null}
      {message ? <p className="mb-3 text-sm text-danger">{message}</p> : null}
      <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving" : "Save record"}</Button>
    </form>
  );
}
