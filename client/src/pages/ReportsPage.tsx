import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, errorMessage } from "@/lib/api";
import { inr, monthRange, todayKey } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { Button, LoadingRows, Notice, PageHeader, Status, TextInput } from "@/components/ui";

type ExpenseRow = { _id: string; dateKey: string; category: string; description: string; amountPaise: number; status: string; vendor?: string };
type InvoiceRow = { _id: string; invoiceNumber: string; status: string; displayStatus: string; clientId?: string; totalPaise: number; paidPaise: number; outstandingPaise: number; issueDate?: string; createdAt?: string };
type PaymentRow = { _id: string; invoiceId?: string; amountPaise: number; method?: string; reference?: string; paidAt?: string; note?: string };
type Slip = { _id: string; employeeName?: string; employeeCode?: string; monthKey?: string; grossPaise?: number; deductionsPaise?: number; statutoryPaise?: number; netPaise?: number };
type PayrollMonth = { month: string; period: { status?: string } | null; payslips: Slip[] };
type Production = {
  uniqueDeliverables: number;
  averageTurnaroundHours: number | null;
  deliverables?: Record<string, number>;
  reshoots?: Record<string, number>;
  publishing: { total: number; published: number; failed: number; onTime: number };
};
type Person = { id: string; name: string; employeeCode?: string; shootsCompleted: number; approvedOutputs: number; revisions: number; postsPublished: number };

function dayKey(value?: string | null) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function inSpan(key: string, from: string, to: string) {
  return Boolean(key) && key >= from && key <= to;
}

function monthKeys(from: string, to: string) {
  const keys: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const endYear = Number(to.slice(0, 4));
  const endMonth = Number(to.slice(5, 7));
  while (keys.length < 24 && (year < endYear || (year === endYear && month <= endMonth))) {
    keys.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return keys;
}

function lastMonthRange(today: string) {
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7)) - 1;
  if (month < 1) { month = 12; year -= 1; }
  const days = new Date(year, month, 0).getDate();
  const stamp = `${year}-${String(month).padStart(2, "0")}`;
  return { from: `${stamp}-01`, to: `${stamp}-${String(days).padStart(2, "0")}` };
}

function axisInr(paise: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(paise) / 100);
}

export function ReportsPage() {
  const { can, user } = useAuth();
  const zone = user?.studio?.businessTimezone ?? "Asia/Kolkata";
  const initial = monthRange(zone);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const months = monthKeys(from, to);
  const clients = useQuery({
    queryKey: ["report-clients"],
    enabled: can("clients.view"),
    queryFn: async () => (await api.get("/clients", { params: { limit: 100 } })).data.data as Array<{ id: string; name: string }>,
  });
  const expenses = useQuery({
    queryKey: ["report-expenses"],
    queryFn: async () => (await api.get("/expenses", { params: { limit: 200 } })).data.data as ExpenseRow[],
  });
  const invoices = useQuery({
    queryKey: ["report-invoices"],
    enabled: can("invoices.view"),
    queryFn: async () => (await api.get("/invoices", { params: { limit: 100 } })).data.data as InvoiceRow[],
  });
  const payments = useQuery({
    queryKey: ["report-payments"],
    enabled: can("payments.view"),
    queryFn: async () => (await api.get("/payments")).data.data as PaymentRow[],
  });
  const production = useQuery({
    queryKey: ["report-production", from, to],
    queryFn: async () => (await api.get("/analytics/production", { params: { from, to } })).data.data as Production,
  });
  const people = useQuery({
    queryKey: ["report-people", from, to],
    queryFn: async () => (await api.get("/analytics/performance", { params: { from, to } })).data.data as { people: Person[] },
  });
  const payroll = useQuery({
    queryKey: ["report-payroll", months.join(",")],
    enabled: can("payroll.view") && months.length > 0,
    queryFn: async () => {
      const rows = await Promise.all(months.map(async (month) => (await api.get(`/payroll/${month}`)).data.data as Omit<PayrollMonth, "month">));
      return rows.map((row, index) => ({ month: months[index], ...row }));
    },
  });

  const issued = new Set(["issued", "partially_paid", "paid"]);
  const view = useMemo(() => {
    const expenseRows = (expenses.data ?? []).filter((row) => inSpan(row.dateKey, from, to));
    const approvedExpenses = expenseRows.filter((row) => row.status === "approved");
    const paymentRows = (payments.data ?? []).filter((row) => inSpan(dayKey(row.paidAt), from, to));
    const invoiceRows = (invoices.data ?? []).filter((row) => issued.has(row.status) && inSpan(dayKey(row.issueDate || row.createdAt), from, to));
    const slips = (payroll.data ?? []).flatMap((month) => (month.payslips ?? []).map((slip) => ({ ...slip, monthKey: slip.monthKey || month.month, periodStatus: month.period?.status })));
    const byMonth = months.map((month) => {
      const invoicedPaise = invoiceRows.filter((row) => dayKey(row.issueDate || row.createdAt).startsWith(month)).reduce((sum, row) => sum + row.totalPaise, 0);
      const collectedPaise = paymentRows.filter((row) => dayKey(row.paidAt).startsWith(month)).reduce((sum, row) => sum + row.amountPaise, 0);
      const expensesPaise = approvedExpenses.filter((row) => row.dateKey.startsWith(month)).reduce((sum, row) => sum + row.amountPaise, 0);
      const payrollPaise = slips.filter((slip) => String(slip.monthKey).startsWith(month)).reduce((sum, slip) => sum + (slip.netPaise ?? 0), 0);
      return { month, invoicedPaise, collectedPaise, expensesPaise, payrollPaise, resultPaise: collectedPaise - expensesPaise - payrollPaise };
    });
    const categories = new Map<string, number>();
    for (const row of approvedExpenses) categories.set(row.category, (categories.get(row.category) ?? 0) + row.amountPaise);
    const ledger = [
      ...paymentRows.map((row) => ({ id: row._id, date: dayKey(row.paidAt), kind: "Income", detail: row.reference || row.method || "Payment", amountPaise: row.amountPaise })),
      ...approvedExpenses.map((row) => ({ id: row._id, date: row.dateKey, kind: "Expense", detail: `${row.category} · ${row.description}`, amountPaise: -row.amountPaise })),
    ].sort((a, b) => b.date.localeCompare(a.date) || a.kind.localeCompare(b.kind));
    return { expenseRows, approvedExpenses, paymentRows, invoiceRows, slips, byMonth, categories: [...categories.entries()].sort((a, b) => b[1] - a[1]), ledger };
  }, [expenses.data, payments.data, invoices.data, payroll.data, from, to, months]);

  const invoiced = view.invoiceRows.reduce((sum, row) => sum + row.totalPaise, 0);
  const collected = view.paymentRows.reduce((sum, row) => sum + row.amountPaise, 0);
  const expenseTotal = view.approvedExpenses.reduce((sum, row) => sum + row.amountPaise, 0);
  const payrollTotal = view.slips.reduce((sum, slip) => sum + (slip.netPaise ?? 0), 0);
  const waiting = view.expenseRows.filter((row) => row.status !== "approved" && row.status !== "rejected");
  const clientName = new Map((clients.data ?? []).map((client) => [client.id, client.name]));

  return (
    <div className="report-page">
      <PageHeader eyebrow="Reports" title="Studio report" text="Income is money collected. Expenses count only after final approval. Payroll is the net pay for each month the dates touch." actions={
        <>
          <Button size="sm" variant="ghost" onClick={() => { const range = monthRange(zone); setFrom(range.from); setTo(range.to); }}>This month</Button>
          <Button size="sm" variant="ghost" onClick={() => { const range = lastMonthRange(todayKey(zone)); setFrom(range.from); setTo(range.to); }}>Last month</Button>
          <Button size="sm" variant="ghost" onClick={() => { const today = todayKey(zone); setFrom(`${today.slice(0, 4)}-01-01`); setTo(today); }}>This year</Button>
          <TextInput className="w-36" type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="From" />
          <TextInput className="w-36" type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="To" />
          <Button size="sm" variant="ghost" onClick={() => window.print()}>Print</Button>
        </>
      } />
      <p className="print-only mb-4 text-sm">{from} to {to}</p>
      {expenses.isError ? <Notice tone="danger">{errorMessage(expenses.error)}</Notice> : null}
      {expenses.isLoading ? <LoadingRows /> : null}
      <section className="report-metrics mb-6 grid border border-line bg-white sm:grid-cols-5">
        {[
          ["Invoiced", invoiced],
          ["Collected", collected],
          ["Expenses", expenseTotal],
          ["Payroll", payrollTotal],
          ["After costs", collected - expenseTotal - payrollTotal],
        ].map(([label, value]) => (
          <div key={String(label)} className="border-b border-line px-4 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
            <div className="eyebrow">{label}</div>
            <div className="num mt-2 text-xl">{inr(Number(value))}</div>
          </div>
        ))}
      </section>

      <section className="mb-6 border border-line bg-white">
        <h2 className="border-b border-line px-4 py-3 font-medium">By month</h2>
        {view.byMonth.some((row) => row.invoicedPaise || row.collectedPaise || row.expensesPaise || row.payrollPaise) ? (
          <>
            <div className="report-chart h-72 min-w-0 overflow-hidden px-1 py-4 sm:px-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={view.byMonth} barSize={14} barGap={4} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="#E6E3DC" />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#666666" }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={axisInr} width={84} tick={{ fontSize: 12, fill: "#666666" }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(value: number, name: string) => [inr(value), name]} cursor={{ fill: "#F7F6F2" }} />
                  <Bar dataKey="collectedPaise" fill="#171717" name="Collected" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="expensesPaise" fill="#FFD500" name="Expenses" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="payrollPaise" fill="#666666" name="Payroll" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <table className="data">
              <thead><tr><th>Month</th><th>Invoiced</th><th>Collected</th><th>Expenses</th><th>Payroll</th><th>After costs</th></tr></thead>
              <tbody>
                {view.byMonth.map((row) => (
                  <tr key={row.month}><td>{row.month}</td><td className="num">{inr(row.invoicedPaise)}</td><td className="num">{inr(row.collectedPaise)}</td><td className="num">{inr(row.expensesPaise)}</td><td className="num">{inr(row.payrollPaise)}</td><td className="num">{inr(row.resultPaise)}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        ) : <p className="px-4 py-8 text-sm text-muted">Nothing was invoiced, collected, spent, or paid as wages in this range.</p>}
      </section>

      <section className="mb-6 border border-line bg-white">
        <h2 className="border-b border-line px-4 py-3 font-medium">Date by date</h2>
        {view.ledger.length ? (
          <table className="data">
            <thead><tr><th>Date</th><th>Kind</th><th>Detail</th><th>Amount</th></tr></thead>
            <tbody>
              {view.ledger.map((row) => (
                <tr key={`${row.kind}-${row.id}`}><td>{row.date}</td><td>{row.kind}</td><td>{row.detail}</td><td className="num">{inr(row.amountPaise)}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <p className="px-4 py-8 text-sm text-muted">No collections or approved expenses on these dates.</p>}
      </section>

      <section className="mb-6 grid gap-6 lg:grid-cols-2">
        <div className="border border-line bg-white">
          <h2 className="border-b border-line px-4 py-3 font-medium">Income by invoice</h2>
          {view.invoiceRows.length ? (
            <table className="data">
              <thead><tr><th>Number</th><th>Client</th><th>Status</th><th>Total</th><th>Collected</th></tr></thead>
              <tbody>
                {view.invoiceRows.map((row) => (
                  <tr key={row._id}><td><Link to={`/invoices/${row._id}`}>{row.invoiceNumber}</Link></td><td>{clientName.get(String(row.clientId)) || "Client"}</td><td><Status value={row.displayStatus || row.status} /></td><td className="num">{inr(row.totalPaise)}</td><td className="num">{inr(row.paidPaise)}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="px-4 py-8 text-sm text-muted">No issued invoices in this range.</p>}
        </div>
        <div className="border border-line bg-white">
          <h2 className="border-b border-line px-4 py-3 font-medium">Expenses by category</h2>
          {view.categories.length ? (
            <table className="data">
              <thead><tr><th>Category</th><th>Amount</th></tr></thead>
              <tbody>{view.categories.map(([category, amount]) => <tr key={category}><td className="capitalize">{category}</td><td className="num">{inr(amount)}</td></tr>)}</tbody>
            </table>
          ) : <p className="px-4 py-8 text-sm text-muted">No approved expenses in this range.</p>}
          {waiting.length ? <p className="border-t border-line px-4 py-2 text-xs text-muted">{waiting.length} expense{waiting.length === 1 ? "" : "s"} in this range {waiting.length === 1 ? "is" : "are"} still waiting for approval and {waiting.length === 1 ? "is" : "are"} not in the totals.</p> : null}
        </div>
      </section>

      <section className="mb-6 border border-line bg-white">
        <h2 className="border-b border-line px-4 py-3 font-medium">Expense lines</h2>
        {view.expenseRows.length ? (
          <table className="data">
            <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Status</th><th>Amount</th></tr></thead>
            <tbody>
              {view.expenseRows.map((row) => (
                <tr key={row._id}><td>{row.dateKey}</td><td className="capitalize">{row.category}</td><td>{row.description}</td><td><Status value={row.status} /></td><td className="num">{inr(row.amountPaise)}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <p className="px-4 py-8 text-sm text-muted">No expenses were filed in this range.</p>}
      </section>

      <section className="mb-6 border border-line bg-white">
        <h2 className="border-b border-line px-4 py-3 font-medium">Payroll</h2>
        {view.slips.length ? (
          <table className="data">
            <thead><tr><th>Month</th><th>Person</th><th>Gross</th><th>Deductions</th><th>Net</th></tr></thead>
            <tbody>
              {view.slips.map((slip) => (
                <tr key={slip._id}><td>{slip.monthKey}</td><td>{slip.employeeCode ? `${slip.employeeCode} · ` : ""}{slip.employeeName}</td><td className="num">{inr(slip.grossPaise)}</td><td className="num">{inr((slip.deductionsPaise ?? 0) + (slip.statutoryPaise ?? 0))}</td><td className="num">{inr(slip.netPaise)}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <p className="px-4 py-8 text-sm text-muted">No payroll has been prepared for these months.</p>}
      </section>

      <section className="mb-6 grid gap-6 lg:grid-cols-2">
        <div className="border border-line bg-white">
          <h2 className="border-b border-line px-4 py-3 font-medium">Production</h2>
          {production.data ? (
            <div className="grid sm:grid-cols-2">
              {[
                ["Deliverables", String(production.data.uniqueDeliverables)],
                ["Turnaround", production.data.averageTurnaroundHours == null ? "—" : `${production.data.averageTurnaroundHours} h`],
                ["Posts", String(production.data.publishing.published)],
                ["On time", String(production.data.publishing.onTime)],
                ["Failed posts", String(production.data.publishing.failed)],
                ["Reshoots", String(Object.values(production.data.reshoots ?? {}).reduce((sum, count) => sum + count, 0))],
              ].map(([label, value]) => (
                <div key={label} className="border-b border-line px-4 py-3"><div className="eyebrow">{label}</div><div className="num mt-1 text-xl">{value}</div></div>
              ))}
            </div>
          ) : <p className="px-4 py-8 text-sm text-muted">Production figures are still loading.</p>}
        </div>
        <div className="border border-line bg-white">
          <h2 className="border-b border-line px-4 py-3 font-medium">People in this period</h2>
          {(people.data?.people ?? []).some((person) => person.shootsCompleted || person.approvedOutputs || person.postsPublished) ? (
            <table className="data">
              <thead><tr><th>Person</th><th>Shoots</th><th>Cuts</th><th>Posts</th></tr></thead>
              <tbody>
                {people.data?.people.filter((person) => person.shootsCompleted || person.approvedOutputs || person.postsPublished || person.revisions).map((person) => (
                  <tr key={person.id}><td>{person.name}</td><td className="num">{person.shootsCompleted}</td><td className="num">{person.approvedOutputs}</td><td className="num">{person.postsPublished}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="px-4 py-8 text-sm text-muted">No completed shoots, approved cuts, or posts in this range.</p>}
        </div>
      </section>
    </div>
  );
}
