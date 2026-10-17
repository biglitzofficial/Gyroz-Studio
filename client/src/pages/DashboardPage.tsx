import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { hasFullAccess, useAuth } from "@/lib/auth";
import { inr, monthRange } from "@/lib/format";
import { ShiftDay } from "@/components/ShiftDay";
import { Empty, LoadingRows, PageHeader, Status, Timeline } from "@/components/ui";

type Dashboard = {
  financial?: { invoicedPaise: number; collectedPaise: number; outstandingPaise: number; expensesPaise: number; payrollPaise: number; cashContributionPaise: number; label: string };
  operations: { activeClients: number; activeProjects: number; pendingDeliverables: number; overdueTasks: number; overdue: Array<{ _id: string; title: string; deliverableCode: string; deadline?: string; status: string }>; todayShoots: Array<{ _id: string; shootCode: string; scheduledDate: string; location?: string; plannedStart?: string; status: string }>; editingQueue: number; pendingApprovals: number; scheduledPosts: number; reshootsOpen: number; blocked: number; invoicesToPrepare?: number };
  attendance?: { presentToday: number; lateToday: number; absentToday: number; openLeave: number };
  pipeline?: { yours: string; posted: number; waitingToPost: number; steps: Array<{ key: string; label: string; count: number; text: string }> };
  mine: { shoots: Array<{ _id: string; shootCode: string; scheduledDate: string; status: string; location?: string; report?: string }>; tasks: Array<{ _id: string; status: string; deliverableId?: string; hoursSpent?: number; outcome?: string }>; posts: Array<{ _id: string; platform: string; status: string }>; plans: Array<{ id: string; kind: string; title: string; dateKey: string; startTime: string; status?: string; assigneeName: string; projectName?: string; location?: string }> };
  activity: Array<{ _id: string; summary: string; createdAt: string }>;
};

export function DashboardPage() {
  const { user } = useAuth();
  const zone = user?.studio?.businessTimezone ?? "Asia/Kolkata";
  const initial = monthRange(zone);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const query = useQuery({
    queryKey: ["dashboard", from, to],
    queryFn: async () => (await api.get("/dashboard", { params: { from, to } })).data.data as Dashboard,
  });
  const data = query.data;
  const studioDesk = user?.role.systemKey === "super_admin" || user?.role.systemKey === "admin";
  const hour = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "numeric", hourCycle: "h23" }).format(new Date());
  const greeting = Number(hour) < 12 ? "Good morning" : Number(hour) < 17 ? "Good afternoon" : "Good evening";
  return (
    <div>
      <PageHeader eyebrow={new Intl.DateTimeFormat("en-IN", { timeZone: zone, weekday: "long", day: "numeric", month: "long" }).format(new Date())} title={`${greeting}, ${user?.name.split(" ")[0]}.`} text={user?.role.name} actions={
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <input className="control w-36 min-w-0 flex-1 sm:flex-none" type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="From" />
          <input className="control w-36 min-w-0 flex-1 sm:flex-none" type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="To" />
        </div>
      } />
      <ShiftDay />
      {query.isLoading ? <LoadingRows /> : null}
      {query.isError ? <Empty title="Dashboard unavailable" text="The studio figures could not be loaded." /> : null}
      <ProgressTracker from={from} to={to} zone={zone} />
      {studioDesk && data?.pipeline ? (
        <section className="mb-6 border border-line bg-white">
          <div className="border-b border-line px-4 py-3">
            <h2 className="font-medium">The job moves in this order</h2>
            <p className="mt-1 text-sm text-muted">Each role picks up only after the previous step is done. Posted so far: {data.pipeline.posted}. Waiting to post: {data.pipeline.waitingToPost}.</p>
          </div>
          <ol className="grid md:grid-cols-3 xl:grid-cols-6">
            {data.pipeline.steps.map((step, index) => (
              <li key={step.key} className={`border-b border-line px-4 py-4 xl:border-b-0 xl:border-r ${step.key === data.pipeline?.yours ? "bg-accent/40" : ""}`}>
                <div className="text-xs text-muted">{index + 1}</div>
                <div className="mt-1 font-medium">{step.label}</div>
                <div className="num text-2xl">{step.count}</div>
                <p className="mt-2 text-xs text-muted">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {data?.financial ? (
        <section className="mb-6 border border-line bg-white">
          <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            {[
              ["Invoiced", data.financial.invoicedPaise],
              ["Collected", data.financial.collectedPaise],
              ["Outstanding", data.financial.outstandingPaise],
              ["Expenses", data.financial.expensesPaise],
              ["Payroll", data.financial.payrollPaise],
              ["Cash contribution", data.financial.cashContributionPaise],
            ].map(([label, value]) => (
              <div key={String(label)} className="min-w-0 border-b border-r border-line px-4 py-4">
                <div className="eyebrow">{label}</div>
                <div className="num mt-2 text-lg sm:text-2xl">{inr(Number(value))}</div>
              </div>
            ))}
          </div>
          <p className="border-t border-line px-4 py-2 text-xs text-muted">{data.financial.label}</p>
        </section>
      ) : null}
      {data ? <WorkDesk dashboard={data} /> : null}
      {data && !studioDesk ? (
        <div className="grid gap-6 lg:grid-cols-12">
          <section className="border border-line bg-white lg:col-span-12">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="font-medium">Your plan</h2>
              <Link className="text-sm" to="/calendar">Open calendar</Link>
            </div>
            {data.mine.plans?.length ? data.mine.plans.map((item) => (
              <div key={item.id} className="grid grid-cols-1 gap-1 border-b border-line px-4 py-3 text-sm last:border-0 sm:grid-cols-[96px_72px_minmax(0,1fr)] sm:items-center sm:gap-3">
                <div className="num">{item.dateKey.slice(5)}</div>
                <div className="num">{item.startTime}</div>
                <div>
                  <div className="font-medium">{item.title}</div>
                  <div className="text-xs text-muted">{item.kind}{item.projectName ? ` · ${item.projectName}` : ""}{item.location ? ` · ${item.location}` : ""} · {item.assigneeName}</div>
                </div>
              </div>
            )) : <p className="px-4 py-8 text-sm text-muted">Nothing is assigned to you.</p>}
          </section>
        </div>
      ) : null}
      {data && studioDesk ? (
        <div className="grid gap-6 lg:grid-cols-12">
          <section className="border border-line bg-white lg:col-span-7">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="font-medium">Today’s shoots</h2>
              <Link className="text-sm" to="/shoots">Open schedule</Link>
            </div>
            {data.operations.todayShoots.length ? data.operations.todayShoots.map((shoot) => (
              <div key={shoot._id} className="grid grid-cols-1 gap-1 border-b border-line px-4 py-3 last:border-0 sm:grid-cols-[88px_minmax(0,1fr)_auto] sm:items-center sm:gap-3">
                <div className="num text-sm">{shoot.plannedStart ?? "—"}</div>
                <div><div className="font-medium">{shoot.shootCode}</div><div className="text-xs text-muted">{shoot.location || "Location not set"}</div></div>
                <Status value={shoot.status} />
              </div>
            )) : <p className="px-4 py-8 text-sm text-muted">Nothing is on the floor today.</p>}
          </section>
          <section className="border border-line bg-white lg:col-span-5">
            <div className="border-b border-line px-4 py-3 font-medium">In motion</div>
            <dl className="grid grid-cols-2">
              {[
                ["Active clients", data.operations.activeClients, "/clients"],
                ["Active projects", data.operations.activeProjects, "/projects"],
                ["Open deliverables", data.operations.pendingDeliverables, "/projects"],
                ["Editing queue", data.operations.editingQueue, "/editing"],
                ["Awaiting review", data.operations.pendingApprovals, "/editing?status=submitted"],
                ["Scheduled posts", data.operations.scheduledPosts, "/publishing"],
                ["Open reshoots", data.operations.reshootsOpen, "/reshoots"],
                ["Blocked", data.operations.blocked, "/editing?status=on_hold"],
              ].map(([label, value, href]) => (
                <Link key={String(label)} to={String(href)} className="border-b border-r border-line px-4 py-3">
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="num text-xl">{value}</dd>
                </Link>
              ))}
            </dl>
          </section>
          <section className="border border-line bg-white lg:col-span-7">
            <div className="border-b border-line px-4 py-3 font-medium">Overdue deliverables</div>
            {data.operations.overdue.length ? (
              <table className="data">
                <thead><tr><th>Deliverable</th><th>Deadline</th><th>Status</th></tr></thead>
                <tbody>
                  {data.operations.overdue.map((item) => (
                    <tr key={item._id}><td><Link to={`/deliverables/${item._id}`}>{item.deliverableCode} · {item.title}</Link></td><td>{item.deadline}</td><td><Status value={item.status} /></td></tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="px-4 py-8 text-sm text-muted">No overdue deliverables in the open states.</p>}
          </section>
          <section className="border border-line bg-white lg:col-span-5">
            <div className="border-b border-line px-4 py-3 font-medium">Recent activity</div>
            {data.activity.length ? <Timeline items={data.activity.map((item) => ({ id: item._id, at: item.createdAt, text: item.summary }))} /> : <p className="px-4 py-8 text-sm text-muted">Activity will appear as the studio works.</p>}
            {data.attendance ? <div className="grid grid-cols-3 border-t border-line text-center">
              <div className="px-3 py-3"><div className="eyebrow">Present</div><div className="num text-xl">{data.attendance.presentToday}</div></div>
              <div className="px-3 py-3"><div className="eyebrow">Late</div><div className="num text-xl">{data.attendance.lateToday}</div></div>
              <div className="px-3 py-3"><div className="eyebrow">Not in</div><div className="num text-xl">{data.attendance.absentToday}</div></div>
            </div> : null}
          </section>
          <section className="border border-line bg-white lg:col-span-12">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="font-medium">Your plan</h2>
              <Link className="text-sm" to="/calendar">Open calendar</Link>
            </div>
            {data.mine.plans?.length ? data.mine.plans.map((item) => (
              <div key={item.id} className="grid grid-cols-1 gap-1 border-b border-line px-4 py-3 text-sm last:border-0 sm:grid-cols-[96px_72px_minmax(0,1fr)] sm:items-center sm:gap-3">
                <div className="num">{item.dateKey.slice(5)}</div>
                <div className="num">{item.startTime}</div>
                <div>
                  <div className="font-medium">{item.title}</div>
                  <div className="text-xs text-muted">{item.kind}{item.projectName ? ` · ${item.projectName}` : ""}{item.location ? ` · ${item.location}` : ""} · {item.assigneeName}</div>
                </div>
              </div>
            )) : <p className="px-4 py-8 text-sm text-muted">Nothing is assigned to you.</p>}
          </section>
        </div>
      ) : null}
    </div>
  );
}

type TrackerTile = { label: string; value: string; href: string };

function inRange(value: string | Date | undefined, from: string, to: string, zone: string) {
  if (!value) return false;
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
  return key >= from && key <= to;
}

function ProgressTracker({ from, to, zone }: { from: string; to: string; zone: string }) {
  const { can, user } = useAuth();
  const personalCamera = can("shoots.log") && !can("shoots.create");
  const studioShoots = can("shoots.view") && !personalCamera;
  const personalEdit = can("editing.claim") && !can("editing.review");
  const reviews = can("editing.review");
  const posts = can("publishing.view");
  const reshootsOn = can("reshoots.view");
  const invoicesOn = can("invoices.view");
  const shoots = useQuery({
    queryKey: ["progress", "shoots", from, to, personalCamera],
    enabled: can("shoots.view"),
    queryFn: async () => (await api.get("/shoots", { params: { from, to, limit: 100, ...(personalCamera ? { mine: "1" } : {}) } })).data.data as Array<{ _id: string; status: string }>,
  });
  const deliverables = useQuery({
    queryKey: ["progress", "deliverables"],
    enabled: can("deliverables.view"),
    queryFn: async () => (await api.get("/deliverables", { params: { limit: 100 } })).data.data as Array<{ _id: string; shootId?: string; status: string; updatedAt?: string }>,
  });
  const queue = useQuery({
    queryKey: ["progress", "queue"],
    enabled: can("editing.view"),
    queryFn: async () => (await api.get("/editing/queue")).data.data as Array<{ _id: string; status: string; claimedBy?: string; hoursSpent?: number; completedAt?: string; submittedAt?: string; claimedAt?: string }>,
  });
  const publishing = useQuery({
    queryKey: ["progress", "publishing"],
    enabled: posts,
    queryFn: async () => (await api.get("/publishing")).data.data as Array<{ _id: string; status: string; publishedAt?: string; createdAt?: string }>,
  });
  const reshoots = useQuery({
    queryKey: ["progress", "reshoots"],
    enabled: reshootsOn,
    queryFn: async () => (await api.get("/reshoots")).data.data as Array<{ _id: string; approvalStatus: string; requestedBy?: string; originalShootId?: string; createdAt?: string }>,
  });
  const invoices = useQuery({
    queryKey: ["progress", "invoices"],
    enabled: invoicesOn,
    queryFn: async () => (await api.get("/invoices")).data.data as Array<{ _id: string; status: string; issueDate?: string; createdAt?: string }>,
  });
  const shootRows = shoots.data ?? [];
  const shootIds = new Set(shootRows.map((item) => item._id));
  const done = shootRows.filter((item) => item.status === "submitted").length;
  const pendingShoots = shootRows.filter((item) => item.status === "scheduled" || item.status === "in_progress").length;
  const approvedCuts = (deliverables.data ?? []).filter((item) => shootIds.has(String(item.shootId)) && ["approved", "ready_to_publish", "published"].includes(item.status)).length;
  const myReshoots = (reshoots.data ?? []).filter((item) => inRange(item.createdAt, from, to, zone) && (String(item.requestedBy) === user?.id || shootIds.has(String(item.originalShootId))));
  const mineTasks = (queue.data ?? []).filter((item) => String(item.claimedBy) === user?.id);
  const touched = mineTasks.filter((item) => inRange(item.completedAt, from, to, zone) || inRange(item.submittedAt, from, to, zone) || inRange(item.claimedAt, from, to, zone) || ["claimed", "in_progress", "on_hold", "submitted", "rework"].includes(item.status));
  const hours = touched.reduce((sum, item) => sum + (Number(item.hoursSpent) || 0), 0);
  const reviewTasks = queue.data ?? [];
  const tiles: TrackerTile[] = [];
  if (personalCamera || studioShoots) {
    tiles.push(
      { label: "Shoots done", value: String(done), href: "/shoots" },
      { label: "Pending", value: String(pendingShoots), href: "/shoots" },
    );
  }
  if (personalCamera) {
    tiles.push(
      { label: "Approved", value: String(approvedCuts), href: "/shoots" },
      { label: "Reshoot", value: String(myReshoots.length), href: "/reshoots" },
    );
  }
  if (personalEdit) {
    const hoursLabel = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
    tiles.push(
      { label: "In progress", value: String(touched.filter((item) => ["claimed", "in_progress", "on_hold"].includes(item.status)).length), href: "/editing" },
      { label: "Pending review", value: String(touched.filter((item) => item.status === "submitted").length), href: "/editing?status=submitted" },
      { label: "Approved", value: String(touched.filter((item) => item.status === "approved").length), href: "/editing?status=approved" },
      { label: "Rework", value: String(touched.filter((item) => item.status === "rework").length), href: "/editing?status=rework" },
      { label: "Hours", value: hoursLabel, href: "/editing" },
    );
  }
  if (reviews) {
    tiles.push(
      { label: "Awaiting review", value: String(reviewTasks.filter((item) => item.status === "submitted").length), href: "/editing?status=submitted" },
      { label: "Approved", value: String(reviewTasks.filter((item) => item.status === "approved" && inRange(item.completedAt, from, to, zone)).length), href: "/editing?status=approved" },
      { label: "Rework", value: String(reviewTasks.filter((item) => item.status === "rework").length), href: "/editing?status=rework" },
    );
  }
  if (reshootsOn && !personalCamera) {
    const monthReshoots = (reshoots.data ?? []).filter((item) => inRange(item.createdAt, from, to, zone) || item.approvalStatus === "pending");
    tiles.push(
      { label: "Reshoots pending", value: String(monthReshoots.filter((item) => item.approvalStatus === "pending").length), href: "/reshoots" },
      { label: "Reshoots approved", value: String(monthReshoots.filter((item) => item.approvalStatus === "approved" && inRange(item.createdAt, from, to, zone)).length), href: "/reshoots" },
    );
  }
  if (posts) {
    const published = (publishing.data ?? []).filter((item) => item.status === "published" && inRange(item.publishedAt, from, to, zone));
    tiles.push(
      { label: "Posted", value: String(published.length), href: "/publishing" },
      { label: "Ready", value: String((publishing.data ?? []).filter((item) => item.status === "ready").length), href: "/publishing" },
      { label: "Scheduled", value: String((publishing.data ?? []).filter((item) => item.status === "scheduled").length), href: "/publishing" },
      { label: "Failed", value: String((publishing.data ?? []).filter((item) => item.status === "failed").length), href: "/publishing" },
    );
  }
  if (invoicesOn) {
    tiles.push(
      { label: "Invoice drafts", value: String((invoices.data ?? []).filter((item) => item.status === "draft" || item.status === "pending_approval").length), href: "/invoices" },
      { label: "Issued", value: String((invoices.data ?? []).filter((item) => ["issued", "partially_paid", "paid"].includes(item.status) && inRange(item.issueDate ?? item.createdAt, from, to, zone)).length), href: "/invoices" },
    );
  }
  const month = new Intl.DateTimeFormat("en-IN", { timeZone: zone, month: "long" }).format(new Date(`${from}T12:00:00`));
  return (
    <section className="mb-6 border border-line bg-white">
      <div className="border-b border-line px-4 py-3">
        <h2 className="font-medium">Progress tracker</h2>
        <p className="mt-1 text-sm text-muted">{month} for {user?.role.name}. Open a figure to work on that page.</p>
      </div>
      {tiles.length ? (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6">
          {tiles.map((tile) => (
            <Link key={tile.label} to={tile.href} className="border-b border-r border-line px-4 py-4">
              <div className="text-xs text-muted">{tile.label}</div>
              <div className="num mt-2 text-2xl">{tile.value}</div>
            </Link>
          ))}
        </div>
      ) : <p className="px-4 py-8 text-sm text-muted">Nothing to track for this role yet.</p>}
    </section>
  );
}

type DeskItem = { id: string; title: string; detail: string; status: string; href: string; action: string };

function WorkDesk({ dashboard }: { dashboard: Dashboard }) {
  const { can, user } = useAuth();
  const review = can("editing.review");
  const claimOnly = can("editing.claim") && !review;
  const publish = can("publishing.publish");
  const approveInvoices = hasFullAccess(user?.role.systemKey);
  const createInvoices = can("invoices.create");
  const expenseQueue = user?.role.systemKey === "super_admin" ? "admin_approved" : user?.role.systemKey === "admin" ? "both" : "";
  const manageTime = can("attendance.manage");
  const ownTime = can("attendance.self") && !manageTime;
  const approveReshoots = can("reshoots.approve");
  const approvePayroll = can("payroll.approve");
  const month = new Date().toISOString().slice(0, 7);
  const cuts = useQuery({
    queryKey: ["desk", "cuts", claimOnly ? "available" : "submitted"],
    enabled: claimOnly || review,
    queryFn: async () => (await api.get("/editing/queue", { params: { status: claimOnly ? "available" : "submitted" } })).data.data as Array<{ _id: string; status: string; deliverableId: string; deliverable?: { title?: string; deliverableCode?: string } }>,
  });
  const posts = useQuery({
    queryKey: ["desk", "posts"],
    enabled: publish,
    queryFn: async () => (await api.get("/publishing")).data.data as Array<{ _id: string; platform: string; status: string; deliverableId: string; clientName?: string; projectName?: string }>,
  });
  const projects = useQuery({
    queryKey: ["desk", "projects"],
    enabled: publish && can("projects.view"),
    queryFn: async () => (await api.get("/projects", { params: { limit: 100 } })).data.data as Array<{ _id: string; name: string; clientId?: string }>,
  });
  const clients = useQuery({
    queryKey: ["desk", "clients"],
    enabled: publish && can("clients.view"),
    queryFn: async () => (await api.get("/clients", { params: { limit: 100 } })).data.data as Array<{ _id?: string; id?: string; name: string }>,
  });
  const invoices = useQuery({
    queryKey: ["desk", "invoices"],
    enabled: approveInvoices,
    queryFn: async () => (await api.get("/invoices")).data.data as Array<{ _id: string; invoiceNumber: string; status: string; totalPaise: number }>,
  });
  const expenses = useQuery({
    queryKey: ["desk", "expenses", expenseQueue],
    enabled: Boolean(expenseQueue),
    queryFn: async () => (await api.get("/expenses", { params: expenseQueue === "both" ? {} : { status: expenseQueue } })).data.data as Array<{ _id: string; description: string; category: string; dateKey: string; amountPaise: number; status: string }>,
  });
  const leave = useQuery({
    queryKey: ["desk", "leave"],
    enabled: manageTime || ownTime,
    queryFn: async () => (await api.get("/leave", { params: { status: "pending" } })).data.data as Array<{ _id: string; employeeId: string; type: string; fromKey: string; toKey: string; reason: string; status: string }>,
  });
  const overtime = useQuery({
    queryKey: ["desk", "overtime"],
    enabled: manageTime || ownTime,
    queryFn: async () => (await api.get("/overtime")).data.data as Array<{ _id: string; employeeId: string; dateKey: string; minutes: number; reason: string; status: string }>,
  });
  const reshoots = useQuery({
    queryKey: ["desk", "reshoots"],
    enabled: approveReshoots,
    queryFn: async () => (await api.get("/reshoots", { params: { status: "pending" } })).data.data as Array<{ _id: string; reshootCode: string; reason: string; approvalStatus: string }>,
  });
  const deliverables = useQuery({
    queryKey: ["desk", "deliverables"],
    enabled: can("deliverables.view"),
    queryFn: async () => (await api.get("/deliverables", { params: { limit: 100 } })).data.data as Array<{ _id: string; title: string; deliverableCode: string; status: string; approvalStatus: string; billableStatus: string; projectId?: string; clientId?: string }>,
  });
  const people = useQuery({
    queryKey: ["desk", "people"],
    enabled: manageTime && can("employees.view"),
    queryFn: async () => (await api.get("/employees", { params: { status: "active", limit: 100 } })).data.data as Array<{ _id: string; id?: string; firstName: string; lastName: string }>,
  });
  const payroll = useQuery({
    queryKey: ["desk", "payroll", month],
    enabled: approvePayroll,
    queryFn: async () => (await api.get(`/payroll/${month}`)).data.data as { period?: { _id: string; monthKey: string; status: string } | null },
  });
  const titleOf = new Map((deliverables.data ?? []).map((item) => [item._id, item]));
  const projectName = new Map((projects.data ?? []).map((item) => [item._id, item]));
  const clientName = new Map((clients.data ?? []).map((item) => [String(item._id || item.id), item.name]));
  const personName = new Map((people.data ?? []).map((person) => [String(person._id ?? person.id), `${person.firstName} ${person.lastName}`]));
  const assigned: DeskItem[] = [
    ...dashboard.mine.plans.map((item) => ({
      id: item.id,
      title: item.title,
      detail: [item.dateKey, item.startTime, item.kind, item.projectName, item.location].filter(Boolean).join(" · "),
      status: item.status || "scheduled",
      href: "/calendar",
      action: "Open",
    })),
    ...(can("shoots.log") ? dashboard.mine.shoots.map((item) => ({
      id: item._id,
      title: item.shootCode,
      detail: [item.scheduledDate, item.location || "Location not set", item.report ? "Report saved" : "Report not logged"].join(" · "),
      status: item.status,
      href: "/shoots",
      action: item.report ? "Continue" : "Log report",
    })) : []),
    ...((can("editing.claim") || can("editing.submit")) ? dashboard.mine.tasks.map((item) => ({
      id: item._id,
      title: titleOf.get(String(item.deliverableId))?.title ?? "Cut on your desk",
      detail: item.outcome || (item.hoursSpent ? `${item.hoursSpent}h logged` : "Log the hours and the outcome"),
      status: item.status,
      href: item.deliverableId ? `/deliverables/${item.deliverableId}` : "/editing",
      action: item.status === "in_progress" ? "Log outcome" : "Open cut",
    })) : []),
  ];
  const waiting: DeskItem[] = [
    ...(claimOnly ? (cuts.data ?? []).slice(0, 8).map((item) => ({
      id: item._id,
      title: item.deliverable?.title ?? "Open cut",
      detail: item.deliverable?.deliverableCode ?? "Camera has handed this over",
      status: "available",
      href: "/editing?status=available",
      action: "Claim",
    })) : []),
    ...(review ? (cuts.data ?? []).slice(0, 8).map((item) => ({
      id: item._id,
      title: item.deliverable?.title ?? "Cut in review",
      detail: item.deliverable?.deliverableCode ?? "Submitted for approval",
      status: "submitted",
      href: `/deliverables/${item.deliverableId}`,
      action: "Approve",
    })) : []),
    ...(review ? (deliverables.data ?? []).filter((item) => item.status === "approved" && item.approvalStatus === "internal_approved").slice(0, 8).map((item) => ({
      id: item._id,
      title: item.title,
      detail: `${item.deliverableCode} · waiting on the client`,
      status: "internal_approved",
      href: `/deliverables/${item._id}`,
      action: "Record approval",
    })) : []),
    ...(publish ? (posts.data ?? []).filter((item) => item.status !== "published").slice(0, 8).map((item) => {
      const cut = titleOf.get(item.deliverableId);
      const project = projectName.get(String(cut?.projectId ?? ""));
      const client = item.clientName || clientName.get(String(cut?.clientId || project?.clientId || "")) || "";
      return {
        id: item._id,
        title: cut?.title ?? item.platform,
        detail: [client, item.projectName || project?.name, cut?.deliverableCode, item.platform].filter(Boolean).join(" · "),
        status: item.status,
        href: "/publishing",
        action: "Post",
      };
    }) : []),
    ...(approveInvoices ? (invoices.data ?? []).filter((item) => item.status === "draft" || item.status === "pending_approval").slice(0, 8).map((item) => ({
      id: item._id,
      title: item.invoiceNumber,
      detail: inr(item.totalPaise),
      status: item.status,
      href: `/invoices/${item._id}`,
      action: "Approve",
    })) : []),
    ...(createInvoices ? (deliverables.data ?? []).filter((item) => item.billableStatus === "eligible").slice(0, 8).map((item) => ({
      id: `bill-${item._id}`,
      title: item.title,
      detail: `${item.deliverableCode} is ready to bill`,
      status: "eligible",
      href: "/invoices",
      action: "Invoice",
    })) : []),
    ...(expenseQueue ? (expenses.data ?? []).filter((item) => expenseQueue === "both" ? item.status === "pending" || item.status === "admin_approved" : item.status === expenseQueue).slice(0, 8).map((item) => ({
      id: item._id,
      title: item.description,
      detail: `${item.dateKey} · ${item.category} · ${inr(item.amountPaise)}`,
      status: item.status,
      href: "/expenses",
      action: item.status === "admin_approved" ? "Decide" : "Approve",
    })) : []),
    ...((leave.data ?? []).filter((item) => item.status === "pending").slice(0, 8).map((item) => ({
      id: item._id,
      title: manageTime ? `${personName.get(String(item.employeeId)) ?? "Staff"} · ${item.type} leave` : `${item.type} leave`,
      detail: `${item.fromKey} to ${item.toKey}. ${item.reason}`,
      status: "pending",
      href: manageTime ? "/attendance#approvals" : "/attendance",
      action: manageTime ? "Approve" : "View",
    }))),
    ...((overtime.data ?? []).filter((item) => item.status === "pending").slice(0, 8).map((item) => ({
      id: item._id,
      title: manageTime ? `${personName.get(String(item.employeeId)) ?? "Staff"} · overtime` : "Overtime",
      detail: `${item.dateKey} · ${item.minutes} min. ${item.reason}`,
      status: "pending",
      href: manageTime ? "/attendance#approvals" : "/attendance",
      action: manageTime ? "Approve" : "View",
    }))),
    ...(approveReshoots ? (reshoots.data ?? []).filter((item) => item.approvalStatus === "pending").slice(0, 8).map((item) => ({
      id: item._id,
      title: item.reshootCode,
      detail: item.reason.replaceAll("_", " "),
      status: "pending",
      href: "/reshoots",
      action: "Approve",
    })) : []),
    ...(payroll.data?.period?.status === "preview" ? [{
      id: payroll.data.period._id,
      title: `Payroll ${payroll.data.period.monthKey}`,
      detail: "Preview is ready to finalize.",
      status: "preview",
      href: "/payroll",
      action: "Finalize",
    }] : []),
  ];
  return (
    <section className="mb-6 grid gap-6 lg:grid-cols-2">
      <DeskColumn title="Assigned to you" text="Open a row to do the work on that page." items={assigned} empty="Nothing is assigned to you." />
      <DeskColumn title="Waiting for you" text="Approval state for this login. Open a row to approve it on that page." items={waiting} empty="Nothing is waiting for your approval." />
    </section>
  );
}

function DeskColumn({ title, text, items, empty }: { title: string; text: string; items: DeskItem[]; empty: string }) {
  return (
    <div className="border border-line bg-white">
      <div className="border-b border-line px-4 py-3">
        <h2 className="font-medium">{title}</h2>
        <p className="mt-1 text-sm text-muted">{text}</p>
      </div>
      {items.length ? items.map((item) => (
        <Link key={item.id} to={item.href} className="grid grid-cols-1 items-start gap-2 border-b border-line px-4 py-3 last:border-0 min-[420px]:grid-cols-[minmax(0,1fr)_auto] min-[420px]:items-center min-[420px]:gap-3">
          <span>
            <span className="block font-medium">{item.title}</span>
            <span className="mt-1 block text-xs text-muted">{item.detail}</span>
          </span>
          <span className="flex items-center gap-2">
            <Status value={item.status} />
            <span className="text-sm">{item.action}</span>
          </span>
        </Link>
      )) : <p className="px-4 py-8 text-sm text-muted">{empty}</p>}
    </div>
  );
}
