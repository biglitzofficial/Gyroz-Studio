import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { inr, monthRange, paiseToRupees, rupeesToPaise } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { Button, Empty, Field, LoadingRows, Notice, PageHeader, SaveAction, Select, Status, TextInput } from "@/components/ui";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Line = { description: string; quantity: number; unitPricePaise: number; discountPaise: number; sourceType?: string; sourceId?: string };
type InvoiceRow = { _id: string; invoiceNumber: string; status: string; displayStatus: string; projectId?: string; clientId?: string; totalPaise: number; paidPaise: number; outstandingPaise: number };
type ReadyCut = { _id: string; deliverableCode: string; title: string; projectId?: string; clientId?: string };

export function InvoicesPage() {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingDelete, setPendingDelete] = useState("");
  const queryClient = useQueryClient();
  const invoices = useQuery({ queryKey: ["invoices"], queryFn: async () => (await api.get("/invoices")).data.data as InvoiceRow[] });
  const ready = useQuery({ queryKey: ["billable"], queryFn: async () => (await api.get("/deliverables", { params: { billableStatus: "eligible", limit: 100 } })).data.data as ReadyCut[], enabled: can("invoices.create") });
  const projects = useQuery({ queryKey: ["projects", "invoices"], queryFn: async () => (await api.get("/projects", { params: { limit: 100 } })).data.data as Array<{ _id: string; name: string; projectCode?: string; clientId?: string }>, enabled: can("projects.view") });
  const clients = useQuery({ queryKey: ["clients"], queryFn: async () => (await api.get("/clients", { params: { limit: 100 } })).data.data as Array<{ id?: string; _id?: string; name: string }>, enabled: open || can("clients.view") });
  const [clientId, setClientId] = useState("");
  const [discount, setDiscount] = useState("500");
  const [lines, setLines] = useState<Line[]>([
    { description: "Shoot charges", quantity: 1, unitPricePaise: 300000, discountPaise: 0 },
    { description: "Editing charges", quantity: 1, unitPricePaise: 150000, discountPaise: 0 },
  ]);
  const preview = useQuery({
    queryKey: ["invoice-preview", lines, discount],
    enabled: open,
    queryFn: async () => (await api.post("/invoices/calculate", { lineItems: lines, discountPaise: rupeesToPaise(discount) ?? 0, taxRateBps: 0 })).data.data,
  });
  const save = useMutation({
    meta: { loading: "Saving the invoice", toast: "Draft invoice created." },
    mutationFn: async () => {
      const discountPaise = rupeesToPaise(discount);
      if (!clientId) throw new Error("Choose a client.");
      if (discountPaise == null) throw new Error("Enter the discount in rupees, with at most two decimal places.");
      if (lines.some((line) => line.description.trim().length < 2 || line.description.trim().length > 160)) throw new Error("Each line needs a description of 2–160 characters.");
      if (lines.some((line) => !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 999)) throw new Error("Each quantity must be a whole number from 1 to 999.");
      if (lines.some((line) => line.unitPricePaise < 0)) throw new Error("Enter each rate in rupees, with at most two decimal places.");
      return api.post("/invoices", { clientId, lineItems: lines.map((line) => ({ ...line, description: line.description.trim() })), discountPaise, taxRateBps: 0, clientNotes: "Thank you for trusting Gyroz Studio." });
    },
    onSuccess: () => { setOpen(false); setMessage("Draft invoice created."); queryClient.invalidateQueries({ queryKey: ["invoices"] }); },
    onError: (error) => setMessage(error instanceof Error && !("isAxiosError" in error) ? error.message : errorMessage(error)),
  });
  const createBill = useMutation({
    meta: { loading: "Opening the invoice", toast: "Draft invoice created." },
    mutationFn: async (items: ReadyCut[]) => {
      const first = items[0];
      if (!first?.clientId) throw new Error("This published video has no client.");
      return api.post("/invoices", {
        clientId: String(first.clientId),
        projectId: first.projectId ? String(first.projectId) : undefined,
        lineItems: items.map((item) => ({
          description: `Published · ${item.deliverableCode} ${item.title}`.slice(0, 160),
          quantity: 1,
          unitPricePaise: 0,
          discountPaise: 0,
          sourceType: "deliverable",
          sourceId: item._id,
          serviceType: "published",
        })),
        discountPaise: 0,
        taxRateBps: 0,
        clientNotes: "Opened from the published videos. Set each rate before you approve.",
      });
    },
    onSuccess: (response) => {
      const id = response.data?.data?.invoice?._id as string | undefined;
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      if (id) navigate(`/invoices/${id}`);
    },
    onError: (error) => setMessage(error instanceof Error && !("isAxiosError" in error) ? error.message : errorMessage(error)),
  });
  const remove = useMutation({
    meta: { loading: "Deleting the draft", toast: "Draft deleted." },
    mutationFn: async (id: string) => api.post(`/invoices/${id}/void`, { reason: "Removed accidental draft." }),
    onSuccess: () => { setMessage("Draft deleted."); queryClient.invalidateQueries({ queryKey: ["invoices"] }); queryClient.invalidateQueries({ queryKey: ["billable"] }); },
    onError: (error) => setMessage(errorMessage(error)),
  });
  const visible = (invoices.data ?? []).filter((invoice) => invoice.status !== "void");
  const projectById = new Map((projects.data ?? []).map((project) => [project._id, project]));
  const clientById = new Map((clients.data ?? []).map((client) => [String(client.id || client._id), client.name]));
  const drafts = visible.filter((invoice) => invoice.status === "draft");
  const billedProjects = new Set(visible.filter((invoice) => ["approved", "issued", "partially_paid", "paid"].includes(invoice.status)).map((invoice) => String(invoice.projectId || "")));
  const groups = new Map<string, ReadyCut[]>();
  for (const item of (ready.data ?? []).filter((item) => {
    const projectId = String(item.projectId || "");
    const hasDraft = drafts.some((invoice) => String(invoice.projectId) === projectId);
    return hasDraft || !billedProjects.has(projectId);
  })) {
    const key = String(item.projectId || item.clientId || item._id);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return (
    <div>
      <PageHeader eyebrow="Billing" title="Invoices" text="A draft opens when a video is published. It lists how many shoots were taken, how much editing was logged, and any reshoots. Change the rates on the draft. Issued invoices stay locked." actions={can("invoices.create") ? <Button onClick={() => setOpen((value) => !value)}>New draft</Button> : null} />
      {[...groups.entries()].map(([key, items]) => {
        const project = projectById.get(String(items[0]?.projectId || ""));
        const clientName = clientById.get(String(items[0]?.clientId || project?.clientId || ""));
        const draft = drafts.find((invoice) => String(invoice.projectId) === String(items[0]?.projectId));
        return (
          <article key={key} className="mb-4 border border-line bg-white px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.12em] text-muted">{clientName || "Client"} · {project?.name || "Project"}{project?.projectCode ? ` · ${project.projectCode}` : ""}</div>
                <h2 className="mt-1 font-medium">Published and ready to bill</h2>
                <p className="mt-1 text-sm text-muted">{items.map((item) => `${item.deliverableCode} ${item.title}`).join(" · ")}</p>
              </div>
              <Status value={draft ? "draft" : "eligible"} />
            </div>
            <div className="mt-3">
              {draft ? <Link className="btn btn-primary btn-sm" to={`/invoices/${draft._id}`}>Edit bill</Link> : <Button size="sm" disabled={createBill.isPending} onClick={() => createBill.mutate(items)}>{createBill.isPending ? "Opening" : "Open bill"}</Button>}
            </div>
          </article>
        );
      })}
      {message ? <p className="mb-3 text-sm">{message}</p> : null}
      {open ? (
        <div className="mb-6 border border-line bg-white p-4">
          <Field label="Client"><Select value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">Select</option>{(clients.data ?? []).map((client) => <option key={client.id || client._id} value={client.id || client._id}>{client.name}</option>)}</Select></Field>
          {lines.map((line, index) => (
            <div key={index} className="mt-3 grid gap-2 md:grid-cols-4">
              <TextInput maxLength={160} value={line.description} onChange={(event) => setLines(lines.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} aria-label="Description" />
              <TextInput inputMode="numeric" value={line.quantity} onChange={(event) => setLines(lines.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: Number(event.target.value) } : item))} aria-label="Quantity" />
              <TextInput value={(line.unitPricePaise / 100).toString()} onChange={(event) => setLines(lines.map((item, itemIndex) => itemIndex === index ? { ...item, unitPricePaise: rupeesToPaise(event.target.value) ?? 0 } : item))} aria-label="Rate in rupees" />
              <Button variant="ghost" onClick={() => setLines(lines.filter((_, itemIndex) => itemIndex !== index))}>Remove</Button>
            </div>
          ))}
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <Field label="Invoice discount (INR)"><TextInput value={discount} onChange={(event) => setDiscount(event.target.value)} /></Field>
            <Button variant="ghost" onClick={() => setLines([...lines, { description: "Additional service", quantity: 1, unitPricePaise: 0, discountPaise: 0 }])}>Add line</Button>
            <SaveAction changed pending={save.isPending} disabled={!clientId} label="Save draft" type="button" onClick={() => save.mutate()} />
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
          {preview.data ? <p className="mt-3 text-sm">Server total before tax {inr(preview.data.taxablePaise)} · tax {inr(preview.data.taxPaise)} · payable {inr(preview.data.totalPaise)}. Amounts are examples until you change them. Rates are not studio defaults.</p> : null}
          <p className="mt-2 text-xs text-muted">Signed in as {user?.name}. Pull approved reshoot charges from the invoice detail after the draft exists.</p>
        </div>
      ) : null}
      {visible.length ? (
        <div className="table-wrap"><table className="data"><thead><tr><th>Number</th><th>Project</th><th>Status</th><th>Total</th><th>Paid</th><th>Outstanding</th><th></th></tr></thead><tbody>
          {visible.map((invoice) => {
            const project = projectById.get(String(invoice.projectId || ""));
            const clientName = clientById.get(String(invoice.clientId || project?.clientId || ""));
            return (
              <tr key={invoice._id}>
                <td><Link to={`/invoices/${invoice._id}`}>{invoice.invoiceNumber}</Link></td>
                <td>{clientName || "Client"} · {project?.name || "Project"}</td>
                <td><Status value={invoice.displayStatus} /></td>
                <td className="num">{inr(invoice.totalPaise)}</td>
                <td className="num">{inr(invoice.paidPaise)}</td>
                <td className="num">{inr(invoice.outstandingPaise)}</td>
                <td className="space-x-2">
                  {invoice.status === "draft" || invoice.status === "pending_approval" ? <Link to={`/invoices/${invoice._id}`}>Edit</Link> : <Link to={`/invoices/${invoice._id}`}>Open</Link>}
                  {invoice.status === "draft" && can("invoices.approve") ? <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => pendingDelete === invoice._id ? remove.mutate(invoice._id) : setPendingDelete(invoice._id)}>{pendingDelete === invoice._id ? "Confirm delete" : "Delete"}</Button> : null}
                </td>
              </tr>
            );
          })}
        </tbody></table></div>
      ) : <Empty title="No invoices" text="Create a draft from real line items. Generating an invoice does not mark it paid." />}
    </div>
  );
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char] ?? char));
}

function openRupeeInvoice(invoice: { invoiceNumber: string; displayStatus: string; clientNotes?: string; lineItems: Array<{ description: string; quantity: number; unitPricePaise: number; discountPaise?: number }>; subtotalPaise: number; discountPaise: number; taxPaise: number; totalPaise: number; paidPaise: number; outstandingPaise: number }, client?: { name?: string; billingAddress?: string; gstin?: string } | null) {
  const lines = invoice.lineItems.map((line) => `<tr><td>${escapeHtml(line.description)}</td><td class="num">${line.quantity}</td><td class="num">${escapeHtml(inr(line.unitPricePaise))}</td><td class="num">${escapeHtml(inr(line.quantity * line.unitPricePaise - (line.discountPaise ?? 0)))}</td></tr>`).join("");
  const total = (label: string, paise: number, strong = false) => `<div class="${strong ? "total" : "row"}"><span>${label}</span><span>${escapeHtml(inr(paise))}</span></div>`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>${escapeHtml(invoice.invoiceNumber)}</title><style>
    body { margin: 0; color: #171717; font-family: Inter, "Segoe UI", sans-serif; background: #fff; }
    .bar { height: 8px; background: #ffd500; }
    main { max-width: 760px; margin: 0 auto; padding: 28px 40px 48px; }
    h1 { font-family: "Iowan Old Style", "Palatino Linotype", Palatino, serif; font-weight: 400; font-size: 36px; margin: 18px 0 0; }
    .muted { color: #666; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; }
    .top { display: flex; justify-content: space-between; align-items: flex-start; }
    table { width: 100%; border-collapse: collapse; margin-top: 28px; font-size: 14px; }
    th { text-align: left; color: #666; font-size: 11px; letter-spacing: 0.12em; border-bottom: 1px solid #e6e3dc; padding: 8px 0; }
    td { padding: 10px 0; border-bottom: 1px solid #f0eee8; vertical-align: top; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .totals { width: 280px; margin-left: auto; margin-top: 16px; }
    .row, .total { display: flex; justify-content: space-between; padding: 4px 0; font-size: 14px; }
    .total { border-top: 1px solid #171717; margin-top: 6px; padding-top: 8px; font-weight: 600; }
    button { margin-top: 28px; height: 36px; padding: 0 14px; background: #ffd500; border: 0; cursor: pointer; }
    @media print { button { display: none; } }
  </style></head><body><div class="bar"></div><main>
    <div class="top"><div><h1>Gyroz</h1><div class="muted">Invoice</div></div><div style="text-align:right"><div>${escapeHtml(invoice.invoiceNumber)}</div><div class="muted">${escapeHtml(invoice.displayStatus)}</div></div></div>
    <p>Billed to<br /><strong>${escapeHtml(client?.name || "Client")}</strong><br />${escapeHtml(client?.billingAddress || "")}${client?.gstin ? `<br />GSTIN ${escapeHtml(client.gstin)}` : ""}</p>
    <table><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead><tbody>${lines}</tbody></table>
    <div class="totals">${total("Subtotal", invoice.subtotalPaise)}${total("Discount", invoice.discountPaise)}${total("GST", invoice.taxPaise)}${total("Total", invoice.totalPaise, true)}${total("Paid", invoice.paidPaise)}${total("Outstanding", invoice.outstandingPaise)}</div>
    <p class="muted" style="letter-spacing:0;text-transform:none;margin-top:28px">${escapeHtml(invoice.clientNotes || "Amounts are in Indian rupees.")}</p>
    <button onclick="print()">Save PDF</button>
  </main></body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const opened = window.open(url, "_blank", "noopener");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return Boolean(opened);
}

export function InvoiceDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { can, user } = useAuth();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  const [paymentKept, setPaymentKept] = useState(false);
  const [message, setMessage] = useState("");
  const query = useQuery({ queryKey: ["invoice", id], queryFn: async () => (await api.get(`/invoices/${id}`)).data.data });
  const act = useMutation({
    meta: {
      loading: (path: string) => path === "issue" ? "Issuing" : path === "void" ? "Updating the invoice" : "Saving",
      toast: (_data: unknown, path: string) => ({ submit: "Submitted for approval.", approve: "Invoice approved.", issue: "Invoice issued.", void: "Invoice voided." }[path] || "Saved."),
    },
    mutationFn: async (path: string) => api.post(`/invoices/${id}/${path}`, path === "void" ? { reason: "Voided from the invoice record." } : {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["invoice", id] }),
    onError: (error) => setMessage(errorMessage(error)),
  });
  const pay = useMutation({
    meta: { loading: "Recording payment", toast: "Payment recorded." },
    mutationFn: async () => {
      const amountPaise = rupeesToPaise(amount);
      if (amountPaise == null || amountPaise <= 0) throw new Error("Enter the payment in rupees, with at most two decimal places.");
      return api.post("/payments", { invoiceId: id, amountPaise, method });
    },
    onSuccess: () => { setAmount(""); setPaymentKept(true); queryClient.invalidateQueries({ queryKey: ["invoice", id] }); },
    onError: (error) => setMessage(error instanceof Error && !("isAxiosError" in error) ? error.message : errorMessage(error)),
  });
  if (query.isLoading) return <LoadingRows />;
  if (!query.data) return <Empty title="Invoice not found" text="It may be outside your assignment." />;
  const { invoice, client, payments } = query.data;
  return (
    <div className="mx-auto max-w-3xl bg-white p-4 sm:p-8">
      <div className="mb-6 h-1 w-16 bg-accent" />
      <div className="flex items-start justify-between gap-4">
        <div><div className="font-display text-4xl">Gyroz</div><div className="eyebrow mt-2">Invoice</div></div>
        <div className="text-right"><div className="num text-lg">{invoice.invoiceNumber}</div><Status value={invoice.displayStatus} /></div>
      </div>
      <p className="mt-6 text-sm">Billed to <strong>{client?.name}</strong><br />{client?.billingAddress}</p>
      <table className="data mt-6"><thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>
        {invoice.lineItems.map((line: { _id: string; description: string; quantity: number; unitPricePaise: number; discountPaise: number }) => (
          <tr key={line._id}><td>{line.description}</td><td className="num">{line.quantity}</td><td className="num">{inr(line.unitPricePaise)}</td><td className="num">{inr(line.quantity * line.unitPricePaise - line.discountPaise)}</td></tr>
        ))}
      </tbody></table>
      {can("invoices.edit") && ["draft", "pending_approval"].includes(invoice.status) ? <BillEditor key={invoice.updatedAt ?? invoice._id} invoice={invoice} onSaved={() => { setMessage("Bill updated."); queryClient.invalidateQueries({ queryKey: ["invoice", id] }); }} onError={setMessage} /> : null}
      <dl className="ml-auto mt-4 w-full max-w-xs text-sm">
        <div className="flex justify-between py-1"><dt>Subtotal</dt><dd className="num">{inr(invoice.subtotalPaise)}</dd></div>
        <div className="flex justify-between py-1"><dt>Discount</dt><dd className="num">{inr(invoice.discountPaise)}</dd></div>
        <div className="flex justify-between py-1"><dt>GST</dt><dd className="num">{inr(invoice.taxPaise)}</dd></div>
        <div className="flex justify-between border-t border-ink py-2 font-medium"><dt>Total</dt><dd className="num">{inr(invoice.totalPaise)}</dd></div>
        <div className="flex justify-between py-1"><dt>Paid</dt><dd className="num">{inr(invoice.paidPaise)}</dd></div>
        <div className="flex justify-between py-1"><dt>Outstanding</dt><dd className="num">{inr(invoice.outstandingPaise)}</dd></div>
      </dl>
      {message ? <p className={`mt-4 text-sm ${message === "Bill updated." ? "" : "text-danger"}`}>{message}</p> : null}
      <div className="no-print mt-6 flex flex-wrap gap-2">
        {can("invoices.edit") && invoice.status === "draft" ? <Button onClick={() => act.mutate("submit")}>Submit for approval</Button> : null}
        {user?.role.systemKey === "super_admin" && ["draft", "pending_approval"].includes(invoice.status) ? <Button onClick={() => act.mutate("approve")}>Approve</Button> : null}
        {can("invoices.issue") && invoice.status === "approved" ? <Button onClick={() => act.mutate("issue")}>Issue</Button> : null}
        {can("invoices.approve") && invoice.status === "draft" && invoice.paidPaise === 0 ? <Button variant="danger" onClick={() => act.mutate("void", { onSuccess: () => navigate("/invoices") })}>Delete draft</Button> : null}
        {can("invoices.approve") && invoice.status !== "draft" && invoice.status !== "void" && invoice.paidPaise === 0 ? <Button variant="danger" onClick={() => act.mutate("void")}>Void</Button> : null}
        <Button variant="ghost" onClick={() => { if (!openRupeeInvoice(invoice, client)) setMessage("Allow pop-ups to open the invoice."); }}>PDF</Button>
      </div>
      {can("payments.record") && ["issued", "partially_paid"].includes(invoice.status) ? (
        <form className="no-print mt-6 flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); pay.mutate(); }}>
          <Field label="Payment (INR)"><TextInput value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
          <Field label="Method"><Select value={method} onChange={(event) => setMethod(event.target.value)}><option value="bank_transfer">Bank transfer</option><option value="upi">UPI</option><option value="cash">Cash</option></Select></Field>
          <SaveAction changed={amount.trim().length > 0 || !paymentKept} stored={paymentKept} pending={pay.isPending} label="Record payment" />
        </form>
      ) : null}
      <section className="mt-6">
        <h2 className="font-medium">Payments</h2>
        {(payments ?? []).map((payment: { _id: string; amountPaise: number; method: string; paidAt: string }) => <div key={payment._id} className="border-b border-line py-2 text-sm">{inr(payment.amountPaise)} · {payment.method} · {new Date(payment.paidAt).toLocaleDateString("en-IN")}</div>)}
        {!payments?.length ? <p className="text-sm text-muted">No payments recorded.</p> : null}
      </section>
    </div>
  );
}

function gstBps(value: string) {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
  return bps <= 10000 ? bps : null;
}

function bpsToGst(bps?: number | null) {
  if (!bps) return "0";
  const whole = Math.trunc(bps / 100);
  const fraction = String(Math.abs(bps % 100)).padStart(2, "0");
  return fraction === "00" ? String(whole) : `${whole}.${fraction}`;
}

function BillEditor({ invoice, onSaved, onError }: {
  invoice: { _id: string; clientId: string; projectId?: string; discountPaise?: number; taxRateBps?: number; clientNotes?: string; internalNotes?: string; lineItems: Array<{ description: string; quantity: number; unitPricePaise: number; discountPaise?: number; sourceType?: string; sourceId?: string; serviceType?: string }> };
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [rows, setRows] = useState(invoice.lineItems.map((line) => ({ ...line, rate: paiseToRupees(line.unitPricePaise) })));
  const [discount, setDiscount] = useState(paiseToRupees(invoice.discountPaise ?? 0));
  const [gst, setGst] = useState(bpsToGst(invoice.taxRateBps));
  const [dirty, setDirty] = useState(false);
  const save = useMutation({
    meta: { loading: "Saving the bill", toast: "Bill updated." },
    mutationFn: async () => {
      if (!rows.length) throw new Error("Keep at least one line on the bill.");
      const discountPaise = rupeesToPaise(discount);
      const taxRateBps = gstBps(gst);
      if (discountPaise == null) throw new Error("Enter the discount in rupees, with at most two decimal places.");
      if (taxRateBps == null) throw new Error("Enter GST as a percent from 0 to 100, such as 18.");
      const lineItems = rows.map((line) => {
        const quantity = Number(line.quantity);
        const unitPricePaise = rupeesToPaise(line.rate);
        if (line.description.trim().length < 2) throw new Error("Each line needs a description.");
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) throw new Error("Each quantity must be a whole number from 1 to 999.");
        if (unitPricePaise == null) throw new Error("Enter each rate in rupees, with at most two decimal places.");
        return {
          description: line.description.trim(),
          quantity,
          unitPricePaise,
          discountPaise: line.discountPaise ?? 0,
          sourceType: line.sourceType,
          sourceId: line.sourceId ? String(line.sourceId) : undefined,
          serviceType: line.serviceType,
        };
      });
      return api.patch(`/invoices/${invoice._id}`, {
        clientId: String(invoice.clientId),
        projectId: invoice.projectId ? String(invoice.projectId) : undefined,
        lineItems,
        discountPaise,
        taxRateBps,
        clientNotes: invoice.clientNotes,
        internalNotes: invoice.internalNotes,
      });
    },
    onSuccess: () => { setDirty(false); onSaved(); },
    onError: (error) => onError(error instanceof Error && !("isAxiosError" in error) ? error.message : errorMessage(error)),
  });
  return (
    <form className="no-print mt-6 border border-line p-4" onChange={() => setDirty(true)} onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
      <h2 className="font-medium">Edit the bill</h2>
      <p className="mt-1 text-sm text-muted">Change a description, quantity, or rate. Remove a line you do not want to charge, including a published video. Set the discount and GST, then save.</p>
      {rows.map((line, index) => (
        <div key={`${line.serviceType ?? "line"}-${line.sourceId ?? index}`} className="mt-3 grid gap-2 md:grid-cols-[1fr_90px_120px_auto]">
          <TextInput value={line.description} maxLength={160} aria-label="Description" onChange={(event) => setRows(rows.map((row, rowIndex) => rowIndex === index ? { ...row, description: event.target.value } : row))} />
          <TextInput inputMode="numeric" value={line.quantity} aria-label="Quantity" onChange={(event) => setRows(rows.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: Number(event.target.value) } : row))} />
          <TextInput value={line.rate} aria-label="Rate in rupees" onChange={(event) => setRows(rows.map((row, rowIndex) => rowIndex === index ? { ...row, rate: event.target.value } : row))} />
          <Button type="button" variant="ghost" onClick={() => { setDirty(true); setRows(rows.filter((_, rowIndex) => rowIndex !== index)); }}>Remove</Button>
        </div>
      ))}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Discount (INR)"><TextInput value={discount} onChange={(event) => setDiscount(event.target.value)} aria-label="Discount in rupees" /></Field>
        <Field label="GST %"><TextInput value={gst} onChange={(event) => setGst(event.target.value)} aria-label="GST percent" /></Field>
      </div>
      <SaveAction className="mt-3" changed={dirty} stored pending={save.isPending} label="Save bill" />
    </form>
  );
}

const EXPENSE_STAGE: Record<string, string> = {
  pending: "With admin",
  admin_approved: "With super admin",
  approved: "Approved",
  rejected: "Rejected",
};

export function ExpensesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ dateKey: new Date().toISOString().slice(0, 10), category: "travel", description: "", amount: "", vendor: "" });
  const query = useQuery({ queryKey: ["expenses"], queryFn: async () => (await api.get("/expenses")).data.data });
  const [notice, setNotice] = useState("");
  const [expenseKept, setExpenseKept] = useState(false);
  const save = useMutation({
    meta: { loading: "Saving the expense", toast: "Expense saved." },
    mutationFn: async () => {
      const amountPaise = rupeesToPaise(form.amount);
      if (amountPaise == null || amountPaise <= 0) throw new Error("Enter an amount in rupees, with at most two decimal places.");
      if (form.description.trim().length < 2 || form.description.trim().length > 160) throw new Error("Describe the expense in 2–160 characters.");
      return api.post("/expenses", { ...form, description: form.description.trim(), amountPaise });
    },
    onSuccess: () => { setForm((current) => ({ ...current, description: "", amount: "" })); setExpenseKept(true); setNotice(""); queryClient.invalidateQueries({ queryKey: ["expenses"] }); },
    onError: (error) => setNotice(error instanceof Error && !("isAxiosError" in error) ? error.message : errorMessage(error)),
  });
  const decide = useMutation({
    meta: { loading: "Saving the decision", toast: (_data: unknown, job: { status: string }) => job.status === "approved" ? "Approved." : "Rejected." },
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" }) => api.post(`/expenses/${id}/decision`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["expenses"] }),
    onError: (error) => setNotice(errorMessage(error)),
  });
  const stage = user?.role.systemKey;
  return (
    <div>
      <PageHeader eyebrow="Costs" title="Expenses" text="Anyone can file an expense. An admin approves it first. Only a super admin can then approve or reject it. Reports count the super admin's approval." />
      <form className="mb-6 grid gap-3 border border-line bg-white p-4 md:grid-cols-4" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
        <TextInput type="date" value={form.dateKey} onChange={(event) => setForm({ ...form, dateKey: event.target.value })} aria-label="Date" />
        <Select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} aria-label="Category"><option value="equipment">Equipment</option><option value="travel">Travel</option><option value="rent">Rent</option><option value="software">Software</option><option value="contractor">Contractor</option><option value="production">Production</option><option value="other">Other</option></Select>
        <TextInput maxLength={160} placeholder="Description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} aria-label="Description" />
        <TextInput inputMode="decimal" placeholder="Amount INR" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} aria-label="Amount" />
        <SaveAction changed={Boolean(form.description.trim() || form.amount.trim()) || !expenseKept} stored={expenseKept} pending={save.isPending} label="Submit expense" />
        {notice ? <p className="text-sm md:col-span-4">{notice}</p> : null}
      </form>
      <div className="table-wrap"><table className="data"><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>
        {(query.data ?? []).map((expense: { _id: string; dateKey: string; category: string; description: string; amountPaise: number; status: string }) => {
          const adminTurn = stage === "admin" && expense.status === "pending";
          const finalTurn = stage === "super_admin" && expense.status === "admin_approved";
          return (
            <tr key={expense._id}>
              <td>{expense.dateKey}</td>
              <td>{expense.category}</td>
              <td>{expense.description}</td>
              <td className="num">{inr(expense.amountPaise)}</td>
              <td><span className="inline-flex items-center gap-2"><Status value={expense.status} /><span className="text-xs text-muted">{EXPENSE_STAGE[expense.status] ?? ""}</span></span></td>
              <td>{adminTurn || finalTurn ? <span className="flex gap-2"><Button size="sm" onClick={() => decide.mutate({ id: expense._id, status: "approved" })}>{finalTurn ? "Final approve" : "Approve"}</Button><Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: expense._id, status: "rejected" })}>Reject</Button></span> : null}</td>
            </tr>
          );
        })}
      </tbody></table></div>
    </div>
  );
}

function axisInr(paise: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(paise) / 100);
}

type FinancialReport = {
  monthly: Array<{ month: string; invoicedPaise: number; collectedPaise: number }>;
  clients: Array<{ clientId: string; name: string; invoicedPaise: number; collectedPaise: number; outstandingPaise: number }>;
  expenseByCategory?: Array<{ category: string; amountPaise: number }>;
  note?: string;
};

type ProductionReport = {
  uniqueDeliverables: number;
  averageTurnaroundHours: number | null;
  publishing: { total: number; published: number; failed: number; onTime: number };
};

export function AnalyticsPage() {
  const { user } = useAuth();
  const range = monthRange(user?.studio?.businessTimezone);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const financial = useQuery({ queryKey: ["financial", from, to], queryFn: async () => (await api.get("/analytics/financial", { params: { from, to } })).data.data as FinancialReport });
  const production = useQuery({ queryKey: ["production-report", from, to], queryFn: async () => (await api.get("/analytics/production", { params: { from, to } })).data.data as ProductionReport });
  const months = financial.data?.monthly ?? [];
  const invoiced = months.reduce((sum, month) => sum + month.invoicedPaise, 0);
  const collected = months.reduce((sum, month) => sum + month.collectedPaise, 0);
  return (
    <div>
      <PageHeader eyebrow="Reports" title="Analytics" text="Figures come from invoices, payments, expenses, and production records." actions={<><Link className="btn btn-ghost btn-sm" to="/reports">Detailed report</Link><TextInput className="w-36" type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="From" /><TextInput className="w-36" type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="To" /></>} />
      {financial.isError ? <Notice tone="danger">{errorMessage(financial.error)}</Notice> : null}
      {financial.isLoading ? <LoadingRows /> : null}
      {financial.data ? (
        <>
          <section className="mb-6 grid border border-line bg-white sm:grid-cols-3">
            <div className="border-b border-line px-4 py-4 sm:border-b-0 sm:border-r"><div className="eyebrow">Invoiced</div><div className="num mt-2 text-2xl">{inr(invoiced)}</div></div>
            <div className="border-b border-line px-4 py-4 sm:border-b-0 sm:border-r"><div className="eyebrow">Collected</div><div className="num mt-2 text-2xl">{inr(collected)}</div></div>
            <div className="px-4 py-4"><div className="eyebrow">Outstanding</div><div className="num mt-2 text-2xl">{inr(invoiced - collected)}</div></div>
          </section>
          <section className="mb-6 border border-line bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
              <h2 className="font-medium">Invoiced and collected</h2>
              <div className="flex gap-4 text-xs text-muted">
                <span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 bg-ink" /> Invoiced</span>
                <span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 bg-accent" /> Collected</span>
              </div>
            </div>
            {months.length ? (
              <div className="h-72 min-w-0 overflow-hidden px-1 py-4 sm:px-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={months} barSize={18} barGap={6} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#E6E3DC" />
                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#666666" }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={axisInr} width={84} tick={{ fontSize: 12, fill: "#666666" }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(value: number, name: string) => [inr(value), name]} cursor={{ fill: "#F7F6F2" }} />
                    <Bar dataKey="invoicedPaise" fill="#171717" name="Invoiced" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="collectedPaise" fill="#FFD500" name="Collected" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : <p className="px-4 py-8 text-sm text-muted">No issued invoices in this range.</p>}
            {financial.data.note ? <p className="border-t border-line px-4 py-2 text-xs text-muted">{financial.data.note}</p> : null}
          </section>
          <section className="mb-6 border border-line bg-white">
            <h2 className="border-b border-line px-4 py-3 font-medium">By client</h2>
            {financial.data.clients.length ? (
              <table className="data">
                <thead><tr><th>Client</th><th>Invoiced</th><th>Collected</th><th>Outstanding</th></tr></thead>
                <tbody>
                  {financial.data.clients.map((client) => (
                    <tr key={client.clientId}><td>{client.name}</td><td className="num">{inr(client.invoicedPaise)}</td><td className="num">{inr(client.collectedPaise)}</td><td className="num">{inr(client.outstandingPaise)}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="px-4 py-8 text-sm text-muted">No client billing in this range.</p>}
          </section>
          <section className="mb-6 border border-line bg-white">
            <h2 className="border-b border-line px-4 py-3 font-medium">Approved expenses by category</h2>
            {(financial.data.expenseByCategory ?? []).length ? (
              <table className="data">
                <thead><tr><th>Category</th><th>Amount</th></tr></thead>
                <tbody>
                  {financial.data.expenseByCategory?.map((row) => (
                    <tr key={row.category}><td className="capitalize">{row.category}</td><td className="num">{inr(row.amountPaise)}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="px-4 py-8 text-sm text-muted">No approved expenses in this range. Open the detailed report for payroll and each dated line.</p>}
          </section>
        </>
      ) : null}
      {production.data ? (
        <section className="grid border border-line bg-white sm:grid-cols-4">
          {[
            ["Deliverables", String(production.data.uniqueDeliverables)],
            ["Approved turnaround", production.data.averageTurnaroundHours == null ? "—" : `${production.data.averageTurnaroundHours} h`],
            ["Posts published", String(production.data.publishing.published)],
            ["On time", String(production.data.publishing.onTime)],
          ].map(([label, value]) => (
            <div key={label} className="border-b border-line px-4 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
              <div className="eyebrow">{label}</div>
              <div className="num mt-2 text-2xl">{value}</div>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
