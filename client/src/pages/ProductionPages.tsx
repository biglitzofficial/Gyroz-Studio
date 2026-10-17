import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { PunchRequired, useOpenPunch } from "@/lib/punch";
import { elapsed, formatStamp, inr, rupeesToPaise, titleCase, todayKey } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { Button, Empty, Field, LoadingRows, Modal, PageHeader, SaveAction, Select, Status, TextArea, TextInput, Timeline } from "@/components/ui";

const columns = [
  ["available", "Available"],
  ["claimed", "Claimed"],
  ["in_progress", "In progress"],
  ["on_hold", "On hold"],
  ["submitted", "In review"],
  ["rework", "Rework"],
  ["approved", "Approved"],
] as const;

export function EditingPage() {
  const { can, user } = useAuth();
  const punch = useOpenPunch();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const setStatus = (value: string) => setParams(value ? { status: value } : {});
  const queryClient = useQueryClient();
  const queue = useQuery({ queryKey: ["queue", status], queryFn: async () => (await api.get("/editing/queue", { params: status ? { status } : {} })).data.data });
  const [holdId, setHoldId] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: async ({ id, action, body }: { id: string; action: string; body?: unknown }) => api.post(`/editing/${id}/${action}`, body ?? {}),
    meta: {
      loading: (job: { action: string }) => ({ claim: "Claiming", start: "Starting", hold: "Placing on hold", resume: "Resuming", release: "Releasing" }[job.action] || "Saving"),
      toast: (_data: unknown, job: { action: string }) => ({ claim: "Claimed.", start: "Started.", hold: "Placed on hold.", resume: "Resumed.", release: "Released." }[job.action] || "Saved."),
    },
    onSuccess: () => { setHoldId(null); queryClient.invalidateQueries({ queryKey: ["queue"] }); },
  });
  const groups = columns.map(([key, label]) => ({ key, label, items: (queue.data ?? []).filter((item: { status: string }) => item.status === key) }));
  return (
    <div>
      <PageHeader eyebrow="Post" title="Editing queue" text="Claim a cut after the camera hands it over. Log your hours and the outcome, then send it for review. A rework stays with the editor who submitted it. Logging stays closed until you punch in, and it locks again after you punch out." />
      <PunchRequired />
      <div className="mb-4 flex flex-wrap gap-2">
        <Button size="sm" variant={status === "" ? "ink" : "ghost"} onClick={() => setStatus("")}>All</Button>
        {columns.map(([key, label]) => <Button key={key} size="sm" variant={status === key ? "ink" : "ghost"} onClick={() => setStatus(key)}>{label}</Button>)}
      </div>
      {act.isError ? <p className="mb-3 text-sm text-danger">{errorMessage(act.error)}</p> : null}
      {queue.isLoading ? <LoadingRows /> : (
        <div className="grid gap-3 xl:grid-cols-4">
          {groups.filter((group) => !status || group.key === status).map((group) => (
            <section key={group.key} className="min-w-0 border border-line bg-white">
              <header className="flex items-center justify-between border-b border-line px-3 py-2"><h2 className="text-sm font-medium">{group.label}</h2><span className="num text-xs text-muted">{group.items.length}</span></header>
              {group.items.map((item: { _id: string; clientName?: string; projectName?: string; deliverable?: { _id: string; title: string; deliverableCode: string; deadline?: string; revisionCount: number }; ownerName?: string; elapsedMinutes?: number; hoursSpent?: number; outcome?: string; holdReason?: string; priority: string; overdue?: boolean; claimedBy?: string }) => (
                <article key={item._id} className="border-b border-line px-3 py-3">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-muted">{item.clientName} · {item.projectName}</div>
                  <Link className="mt-1 block font-medium" to={`/deliverables/${item.deliverable?._id}`}>{item.deliverable?.title}</Link>
                  <div className="mt-1 text-xs text-muted">{item.deliverable?.deliverableCode} · due {item.deliverable?.deadline || "—"} · rev {item.deliverable?.revisionCount ?? 0}</div>
                  <div className="mt-2"><Status value={item.priority} /></div>
                  <div className="mt-2 text-xs">
                    {item.ownerName ? <span className="font-medium">Occupied by {item.ownerName}</span> : <span className="text-muted">Open</span>}
                    <span className="text-muted"> · {elapsed(item.elapsedMinutes)}{item.hoursSpent ? ` · ${item.hoursSpent}h logged` : ""}{item.overdue ? " · overdue" : ""}</span>
                    {item.outcome ? <div className="mt-1 text-muted">{item.outcome}</div> : null}
                  </div>
                  {item.holdReason ? <p className="mt-2 text-xs text-warning">{item.holdReason}</p> : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {punch.open && item.priority && group.key === "available" && can("editing.claim") ? <Button size="sm" onClick={() => act.mutate({ id: item._id, action: "claim" })}>Claim</Button> : null}
                    {punch.open && group.key === "claimed" && String(item.claimedBy) === user?.id ? <Button size="sm" onClick={() => act.mutate({ id: item._id, action: "start" })}>Start</Button> : null}
                    {punch.open && group.key === "in_progress" && String(item.claimedBy) === user?.id ? <Button size="sm" variant="ghost" onClick={() => setHoldId(item._id)}>Hold</Button> : null}
                    {punch.open && group.key === "on_hold" && String(item.claimedBy) === user?.id ? <Button size="sm" onClick={() => act.mutate({ id: item._id, action: "resume" })}>Resume</Button> : null}
                    {punch.open && ["claimed", "in_progress", "on_hold"].includes(group.key) && String(item.claimedBy) === user?.id ? <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: item._id, action: "release" })}>Release</Button> : null}
                    {punch.open && group.key === "in_progress" && String(item.claimedBy) === user?.id ? <Link className="text-xs" to={`/deliverables/${item.deliverable?._id}`}>Log hours and outcome</Link> : null}
                  </div>
                </article>
              ))}
              {!group.items.length ? <p className="px-3 py-6 text-xs text-muted">Empty</p> : null}
            </section>
          ))}
        </div>
      )}
      {holdId ? <Ask title="Place on hold" label="Reason" submitLabel="Hold task" onClose={() => setHoldId(null)} onSubmit={(reason) => act.mutate({ id: holdId, action: "hold", body: { reason } })} /> : null}
    </div>
  );
}

export function DeliverablePage() {
  const { id = "" } = useParams();
  const { can, user } = useAuth();
  const punch = useOpenPunch();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState("");
  const [hours, setHours] = useState("");
  const [message, setMessage] = useState("");
  const [rework, setRework] = useState(false);
  const [reassign, setReassign] = useState(false);
  const people = useQuery({
    queryKey: ["employees", "reassign"],
    queryFn: async () => (await api.get("/employees", { params: { assign: "editor", status: "active", limit: 100 } })).data.data as Array<{ userId?: string; firstName: string; lastName: string; designation?: string }>,
    enabled: reassign,
  });
  const query = useQuery({ queryKey: ["deliverable", id], queryFn: async () => (await api.get(`/deliverables/${id}`)).data.data });
  const clients = useQuery({
    queryKey: ["clients", "names"],
    enabled: can("clients.view"),
    queryFn: async () => (await api.get("/clients", { params: { limit: 100 } })).data.data as Array<{ _id?: string; id?: string; name: string }>,
  });
  const run = useMutation({
    mutationFn: async (job: { run: () => Promise<unknown>; loading?: string; toast?: string }) => job.run(),
    meta: {
      loading: (job: { loading?: string }) => job.loading || "Saving",
      toast: (_data: unknown, job: { toast?: string }) => job.toast || "Saved.",
    },
    onSuccess: () => { setMessage(""); queryClient.invalidateQueries({ queryKey: ["deliverable", id] }); },
    onError: (error) => setMessage(errorMessage(error)),
  });
  if (query.isLoading) return <LoadingRows />;
  if (!query.data) return <Empty title="Deliverable not found" text="It may be outside your assignment." />;
  const { deliverable, task, history, reviews, reshoots, publishing, timeline, project, people: names } = query.data;
  const mine = task && String(task.claimedBy) === user?.id;
  const ownerName = task?.claimedBy ? names?.[String(task.claimedBy)] : "";
  const clientName = (clients.data ?? []).find((item) => String(item._id || item.id) === String(project?.clientId || deliverable.clientId))?.name;
  return (
    <div>
      <PageHeader eyebrow={deliverable.deliverableCode} title={deliverable.title} text={`${clientName ? `${clientName} · ` : ""}${project?.name ?? "Project"}${project?.projectCode ? ` · ${project.projectCode}` : ""} · revision ${deliverable.revisionCount}`} />
      <div className="mb-4 flex flex-wrap gap-2"><Status value={deliverable.status} /><Status value={deliverable.approvalStatus} /><Status value={deliverable.billableStatus} /></div>
      {message ? <p className="mb-3 text-sm">{message}</p> : null}
      <div className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
        <div className="space-y-4">
          <section className="border border-line bg-white p-4">
            <h2 className="font-medium">Brief</h2>
            <p className="mt-2 text-sm text-graphite">{deliverable.brief || "No brief recorded."}</p>
            <div className="mt-3 text-xs text-muted">Platform {deliverable.platform || "—"} · {deliverable.aspectRatio || "Format open"} · due {deliverable.deadline || "—"}</div>
            <div className="mt-3 text-sm">{(deliverable.sourceReferences ?? []).map((ref: { url?: string; label?: string }, index: number) => <a key={index} className="mr-3 underline" href={ref.url}>{ref.label || ref.url}</a>)}</div>
          </section>
          {mine && task.status === "in_progress" && can("editing.submit") && !punch.open ? <PunchRequired /> : null}
          {mine && task.status === "in_progress" && can("editing.submit") && punch.open ? (
            <form className="border border-line bg-white p-4" onSubmit={(event) => {
              event.preventDefault();
              const hoursSpent = Number(hours);
              if (!(hoursSpent > 0) || hoursSpent > 200) { setMessage("Enter the hours spent, up to 200."); return; }
              if (notes.trim().length < 2) { setMessage("Describe the outcome in a sentence."); return; }
              run.mutate({ loading: "Handing to review", toast: "Handed to review.", run: () => api.post(`/editing/${task._id}/submit`, { notes: notes.trim(), hoursSpent }) });
            }}>
              <h2 className="font-medium">{task.holdReason ? "Log the rework, then send it on" : "Log the outcome, then send it on"}</h2>
              {task.holdReason ? <p className="mt-2 border border-line bg-paper px-3 py-2 text-sm">Sent back: {task.holdReason}</p> : <p className="mt-1 text-sm text-muted">After review, the social manager or an admin can post this.</p>}
              <Field label="Hours spent"><TextInput inputMode="decimal" value={hours} onChange={(event) => setHours(event.target.value)} placeholder="2.5" /></Field>
              <Field label="Outcome"><TextArea maxLength={240} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={task.holdReason ? "What you changed for this rework." : "What was cut, and what is ready."} /></Field>
              <SaveAction className="mt-3" changed label="Hand to review" />
            </form>
          ) : null}
          {task?.status === "submitted" && can("editing.review") ? (
            <div className="flex gap-2">
              <Button onClick={() => run.mutate({ loading: "Approving", toast: "Approved.", run: () => api.post(`/deliverables/${id}/reviews`, { decision: "approved" }) })}>Approve</Button>
              <Button variant="danger" onClick={() => setRework(true)}>Request rework</Button>
            </div>
          ) : null}
          {deliverable.approvalStatus === "internal_approved" && project?.requiresClientApproval && can("editing.review") ? <Button onClick={() => run.mutate({ loading: "Recording approval", toast: "Client approval recorded.", run: () => api.post(`/deliverables/${id}/client-approval`, {}) })}>Record client approval</Button> : null}
          {can("editing.reassign") && task && ["claimed", "in_progress", "on_hold", "rework"].includes(task.status) ? <Button variant="ghost" onClick={() => setReassign(true)}>Reassign</Button> : null}
          <section className="border border-line bg-white">
            <h2 className="border-b border-line px-4 py-3 font-medium">Timeline</h2>
            <Timeline items={[
              ...(timeline ?? []).map((item: { _id: string; summary: string; createdAt?: string }) => ({ id: item._id, at: item.createdAt, text: item.summary })),
              ...(history ?? []).map((item: { _id: string; action: string; reason?: string; createdAt?: string }) => ({ id: item._id, at: item.createdAt, text: `${titleCase(item.action)}${item.reason ? ` — ${item.reason}` : ""}` })),
            ]} />
          </section>
        </div>
        <aside className="space-y-4">
          <section className="border border-line bg-white p-4 text-sm">
            <div className="eyebrow">Task</div>
            <div className="mt-2"><Status value={task?.status ?? "none"} /></div>
            <p className="mt-2 font-medium">{ownerName ? `Occupied by ${ownerName}` : "Open. No editor has claimed this."}</p>
            <p className="mt-2 text-muted">{task?.hoursSpent ? `${task.hoursSpent}h · ` : ""}{task?.outcome || task?.workNotes || "No outcome recorded yet."}</p>
          </section>
          <section className="border border-line bg-white p-4 text-sm">
            <div className="eyebrow">Reviews</div>
            {(reviews ?? []).length ? (reviews ?? []).map((review: { _id: string; decision: string; feedback?: string; kind: string; createdAt?: string }) => <p key={review._id} className="mt-2"><span className="num text-muted">{formatStamp(review.createdAt, user?.studio?.businessTimezone ?? "Asia/Kolkata")}</span> · {review.kind}: {review.decision}. {review.feedback}</p>) : <p className="mt-2 text-muted">No review yet.</p>}
          </section>
          <section className="border border-line bg-white p-4 text-sm">
            <div className="eyebrow">Reshoots</div>
            {(reshoots ?? []).length ? reshoots.map((item: { _id: string; reshootCode: string; approvalStatus: string }) => <p key={item._id} className="mt-2">{item.reshootCode} · {item.approvalStatus}</p>) : <p className="mt-2 text-muted">None linked.</p>}
            {can("reshoots.create") ? <Button className="mt-3" size="sm" variant="ghost" onClick={() => run.mutate({ loading: "Requesting a reshoot", toast: "Reshoot requested.", run: () => api.post("/reshoots", { deliverableId: id, reason: "missing_shots", notes: "Requested from the deliverable." }) })}>Request reshoot</Button> : null}
          </section>
          <section className="border border-line bg-white p-4 text-sm">
            <div className="eyebrow">Publishing</div>
            {publishing ? (
              <div className="mt-2 space-y-2">
                <Status value={publishing.status} />
                <p>{clientName || "Client"} · {project?.name || "Project"}</p>
                <p className="text-muted">{publishing.platform}{deliverable.aspectRatio ? ` · ${deliverable.aspectRatio}` : ""}{publishing.scheduledAt ? ` · ${new Date(publishing.scheduledAt).toLocaleString("en-IN")}` : ""}</p>
                {publishing.caption ? <p>{publishing.caption}</p> : null}
                {task?.outcome ? <p className="text-muted">Editor: {task.outcome}{task.hoursSpent ? ` · ${task.hoursSpent}h` : ""}</p> : null}
                {publishing.notes ? <p className="text-muted">{publishing.notes}</p> : null}
                {publishing.publishedUrl ? <a href={publishing.publishedUrl}>{publishing.publishedUrl}</a> : <p className="text-muted">No live link recorded yet.</p>}
              </div>
            ) : <p className="mt-2 text-muted">Publishing opens after the required approvals.</p>}
          </section>
        </aside>
      </div>
      {rework ? <Ask title="Request rework" label="What needs to change" submitLabel="Send back" onClose={() => setRework(false)} onSubmit={(feedback) => { setRework(false); run.mutate({ loading: "Sending back", toast: "Sent back for rework.", run: () => api.post(`/deliverables/${id}/reviews`, { decision: "rework", feedback }) }); }} /> : null}
      {reassign && task ? (
        <ReassignDialog
          people={(people.data ?? []).filter((person) => person.userId)}
          onClose={() => setReassign(false)}
          onSubmit={(toUserId, reason) => { setReassign(false); run.mutate({ loading: "Reassigning", toast: "Reassigned.", run: () => api.post(`/editing/${task._id}/reassign`, { toUserId, reason }) }); }}
        />
      ) : null}
    </div>
  );
}

export function ReshootsPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["reshoots"], queryFn: async () => (await api.get("/reshoots")).data.data });
  const [chargeFor, setChargeFor] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: async ({ id, charge }: { id: string; charge: number }) => api.post(`/reshoots/${id}/decision`, { approvalStatus: "approved", billableDecision: charge > 0 ? "approved" : "waived", chargePaise: charge }),
    meta: {
      loading: "Saving the decision",
      toast: (_data: unknown, job: { charge: number }) => job.charge > 0 ? "Reshoot charge approved." : "Reshoot charge waived.",
    },
    onSuccess: () => { setChargeFor(null); queryClient.invalidateQueries({ queryKey: ["reshoots"] }); },
  });
  return (
    <div>
      <PageHeader eyebrow="Accountability" title="Reshoots" text="Approving sends the rework to the original cameraman. They log it on Shoots, then the same video goes back through editing, review, and posting." />
      {(query.data ?? []).length ? (
        <div className="table-wrap"><table className="data"><thead><tr><th>Code</th><th>Reason</th><th>Approval</th><th>Billing</th><th>Charge</th><th></th></tr></thead><tbody>
          {(query.data ?? []).map((item: { _id: string; reshootCode: string; reason: string; approvalStatus: string; billableDecision: string; chargePaise: number; deliverableId: string }) => (
            <tr key={item._id}>
              <td className="num">{item.reshootCode}</td>
              <td>{item.reason.replaceAll("_", " ")}</td>
              <td><Status value={item.approvalStatus} /></td>
              <td><Status value={item.billableDecision} /></td>
              <td className="num">{item.chargePaise ? inr(item.chargePaise) : "—"}</td>
              <td className="flex gap-2">{item.approvalStatus === "pending" && can("reshoots.approve") ? <><Button size="sm" onClick={() => setChargeFor(item._id)}>Approve charge</Button><Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: item._id, charge: 0 })}>Waive</Button></> : item.approvalStatus === "approved" ? <span className="text-sm">With the cameraman</span> : <Link to={`/deliverables/${item.deliverableId}`}>Open</Link>}</td>
            </tr>
          ))}
        </tbody></table></div>
      ) : <Empty title="No reshoot requests" text="Requests appear here without creating a second video." />}
      {decide.isError ? <p className="mt-3 text-sm text-danger">{errorMessage(decide.error)}</p> : null}
      {chargeFor ? (
        <Ask
          title="Approve a reshoot charge"
          label="Amount in rupees"
          submitLabel="Approve"
          inputType="text"
          onClose={() => setChargeFor(null)}
          onSubmit={(rupees) => {
            const charge = rupeesToPaise(rupees);
            if (charge == null || charge <= 0) return;
            decide.mutate({ id: chargeFor, charge });
          }}
        />
      ) : null}
    </div>
  );
}

type ReachReading = { views: number; likes: number; recordedOn: string; note?: string; recordedAt?: string };

type PublishItem = {
  _id: string;
  platform: string;
  status: string;
  scheduledAt?: string;
  publishedAt?: string;
  publishedUrl?: string;
  deliverableId: string;
  clientId?: string;
  projectId?: string;
  clientName?: string;
  projectName?: string;
  projectCode?: string;
  caption?: string;
  notes?: string;
  outcome?: string;
  hoursSpent?: number;
  viewCount?: number;
  likeCount?: number;
  metricsUpdatedAt?: string;
  readings?: ReachReading[];
  deliverable?: { title?: string; deliverableCode?: string; brief?: string; deadline?: string; aspectRatio?: string; revisionCount?: number; projectId?: string; clientId?: string };
};

type PublishPage = {
  items: PublishItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: { total: number; published: number; tracked: number };
};

const PAGE_SIZE = 20;
const STATUSES = [["", "All"], ["ready", "Ready"], ["scheduled", "Scheduled"], ["published", "Published"], ["failed", "Failed"]] as const;
const REACH = [["", "All reach"], ["views", "High views"], ["likes", "High likes"], ["untracked", "Not tracked"]] as const;

function tally(value?: number) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-IN").format(value);
}

export function PublishingPage() {
  const { can, user } = useAuth();
  const punch = useOpenPunch();
  const [view, setView] = useState<"list" | "calendar">("list");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [reach, setReach] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [dialog, setDialog] = useState<{ id: string; path: "schedule" | "publish" | "reach" } | null>(null);
  const queryClient = useQueryClient();
  useEffect(() => {
    const timer = window.setTimeout(() => setQ(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const query = useQuery({
    queryKey: ["publishing", page, status, reach, q],
    queryFn: async () => (await api.get("/publishing", { params: { page, limit: PAGE_SIZE, ...(status ? { status } : {}), ...(reach ? { reach } : {}), ...(q ? { q } : {}) } })).data.data as PublishPage,
    enabled: view === "list",
  });
  const calendar = useQuery({
    queryKey: ["publishing", "calendar"],
    queryFn: async () => (await api.get("/publishing")).data.data as PublishItem[],
    enabled: view === "calendar",
  });
  const act = useMutation({
    mutationFn: async ({ id, path, body }: { id: string; path: string; body: unknown }) => api.post(`/publishing/${id}/${path}`, body),
    meta: {
      loading: (job: { path: string }) => job.path === "metrics" ? "Saving reach" : job.path === "publish" ? "Publishing" : "Scheduling",
      toast: (_data: unknown, job: { path: string }) => job.path === "metrics" ? "Reach saved." : job.path === "publish" ? "Published." : "Scheduled.",
    },
    onSuccess: () => { setDialog(null); queryClient.invalidateQueries({ queryKey: ["publishing"] }); queryClient.invalidateQueries({ queryKey: ["deliverable"] }); },
  });
  const pageData = query.data;
  const items = pageData?.items ?? [];
  const active = items.find((item) => item._id === dialog?.id) ?? (calendar.data ?? []).find((item) => item._id === dialog?.id);
  const summary = pageData?.summary;
  const total = pageData?.total ?? 0;
  const pageSize = pageData?.pageSize ?? PAGE_SIZE;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  function pickStatus(value: string) {
    setStatus(value);
    setPage(1);
  }
  function pickReach(value: string) {
    setReach(value);
    if (value) setStatus("");
    setPage(1);
  }
  useEffect(() => {
    if (!pageData) return;
    const last = Math.max(1, Math.ceil(pageData.total / (pageData.pageSize || PAGE_SIZE)));
    if (page > last) setPage(last);
  }, [pageData, page]);
  return (
    <div>
      <PageHeader eyebrow="Distribution" title="Publishing" text={`Posted ${summary?.published ?? 0} of ${summary?.total ?? 0}. After a post is live, record views and likes, then update those numbers whenever you check the platform. ${summary?.tracked ?? 0} published posts have a reading. Publishing stays closed until you punch in.`} actions={<Button variant="ghost" onClick={() => setView(view === "list" ? "calendar" : "list")}>{view === "list" ? "Calendar" : "List"}</Button>} />
      <PunchRequired />
      {act.isError ? <p className="mb-3 text-sm text-danger">{errorMessage(act.error)}</p> : null}
      {view === "list" ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <TextInput className="w-full sm:w-64" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search client, project, or cut" aria-label="Search posts" />
          <div className="w-full sm:w-40"><Select value={status} aria-label="Status" onChange={(event) => pickStatus(event.target.value)}>
            {STATUSES.map(([value, label]) => <option key={value || "all"} value={value}>{label}</option>)}
          </Select></div>
          <div className="w-full sm:w-44"><Select value={reach} aria-label="Reach" onChange={(event) => pickReach(event.target.value)}>
            {REACH.map(([value, label]) => <option key={value || "reach"} value={value}>{label}</option>)}
          </Select></div>
        </div>
      ) : null}
      {view === "calendar" ? (calendar.isLoading ? <LoadingRows /> : <PublishCalendar items={calendar.data ?? []} />) : query.isLoading ? <LoadingRows /> : items.length ? (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Cut</th>
                  <th>Client</th>
                  <th>Project</th>
                  <th>Platform</th>
                  <th>Status</th>
                  <th>Views</th>
                  <th>Likes</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item._id}>
                    <td data-label="Cut">
                      <Link className="font-medium" to={`/deliverables/${item.deliverableId}`}>{item.deliverable?.title || item.platform}</Link>
                      <div className="text-xs text-muted">{item.deliverable?.deliverableCode || "Cut"}</div>
                    </td>
                    <td data-label="Client">{item.clientName || "—"}</td>
                    <td data-label="Project">{item.projectName || "—"}{item.projectCode ? <div className="text-xs text-muted">{item.projectCode}</div> : null}</td>
                    <td data-label="Platform">{item.platform}</td>
                    <td data-label="Status"><Status value={item.status} /></td>
                    <td data-label="Views" className="num">{item.status === "published" ? tally(item.viewCount) : "—"}</td>
                    <td data-label="Likes" className="num">{item.status === "published" ? tally(item.likeCount) : "—"}</td>
                    <td data-label="Updated">{item.metricsUpdatedAt ? new Date(item.metricsUpdatedAt).toLocaleDateString("en-IN") : item.status === "published" ? "Not tracked" : "—"}</td>
                    <td data-label="">
                      <div className="flex flex-wrap gap-2">
                        {can("publishing.schedule") && item.status !== "published" ? <Button size="sm" variant="ghost" onClick={() => setDialog({ id: item._id, path: "schedule" })}>Schedule</Button> : null}
                        {punch.open && can("publishing.publish") && item.status !== "published" ? <Button size="sm" onClick={() => setDialog({ id: item._id, path: "publish" })}>Publish</Button> : null}
                        {can("publishing.publish") && item.status === "published" ? <Button size="sm" onClick={() => setDialog({ id: item._id, path: "reach" })}>{item.metricsUpdatedAt ? "Update reach" : "Add reach"}</Button> : null}
                        {item.publishedUrl ? <a className="text-sm" href={item.publishedUrl} target="_blank" rel="noreferrer">Live</a> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
            <span>{total ? `${from}–${to} of ${total}` : "No posts in this view"}</span>
            <span className="flex gap-2">
              <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
              <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage((current) => current + 1)}>Next</Button>
            </span>
          </div>
        </>
      ) : null}
      {!query.isLoading && view === "list" && !items.length ? <Empty title={summary?.total ? "Nothing matches this filter" : "Nothing is ready to publish"} text={summary?.total ? "Clear the search or choose another filter." : "Approved deliverables appear here. Approval is never implied by an upload."} /> : null}
      {dialog && active && dialog.path === "schedule" ? <Ask title={`Schedule ${active.deliverable?.title || active.platform}`} detail={`${active.clientName || "Client"} · ${active.projectName || "Project"} · ${active.platform}`} label="Date and time" submitLabel="Schedule" inputType="datetime-local" onClose={() => setDialog(null)} onSubmit={(value) => act.mutate({ id: dialog.id, path: "schedule", body: { scheduledAt: new Date(value).toISOString() } })} /> : null}
      {dialog && active && dialog.path === "publish" ? <PublishDialog item={active} onClose={() => setDialog(null)} onSubmit={(body) => act.mutate({ id: dialog.id, path: "publish", body })} /> : null}
      {dialog && active && dialog.path === "reach" ? <ReachDialog item={active} zone={user?.studio?.businessTimezone} onClose={() => setDialog(null)} onSubmit={(body) => act.mutate({ id: dialog.id, path: "metrics", body })} /> : null}
    </div>
  );
}

const PLATFORMS = ["Instagram", "YouTube", "Facebook", "LinkedIn", "Website", "Other"];
const FORMATS = ["9:16", "4:5", "1:1", "16:9"];

function PublishDialog({ item, onClose, onSubmit }: { item: PublishItem; onClose: () => void; onSubmit: (body: { publishedUrl: string; platform: string; aspectRatio?: string; caption?: string; notes?: string }) => void }) {
  const known = PLATFORMS.includes(item.platform) ? item.platform : "";
  const [platform, setPlatform] = useState(known);
  const [custom, setCustom] = useState(!known && item.platform && item.platform !== "unspecified" ? item.platform : "");
  const [format, setFormat] = useState(item.deliverable?.aspectRatio || "");
  const [caption, setCaption] = useState(item.caption || "");
  const [notes, setNotes] = useState(item.notes || "");
  const [url, setUrl] = useState("https://");
  const [error, setError] = useState("");
  const chosen = platform === "Other" ? custom.trim() : platform;
  return (
    <Modal title={`Publish ${item.deliverable?.title || "this cut"}`} onClose={onClose}>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (chosen.length < 2) { setError("Choose the platform."); return; }
        let parsed: URL;
        try { parsed = new URL(url.trim()); } catch { setError("Enter the live URL, starting with https://"); return; }
        if (!["http:", "https:"].includes(parsed.protocol)) { setError("Enter the live URL, starting with https://"); return; }
        setError("");
        onSubmit({ publishedUrl: url.trim(), platform: chosen, aspectRatio: format || undefined, caption: caption.trim() || undefined, notes: notes.trim() || undefined });
      }}>
        <p className="mb-3 text-sm text-muted">{item.clientName || "Client"} · {item.projectName || "Project"} · {item.deliverable?.deliverableCode || "Cut"}</p>
        <Field label="Platform">
          <Select value={platform} onChange={(event) => setPlatform(event.target.value)} required>
            <option value="">Select</option>
            {PLATFORMS.map((name) => <option key={name} value={name}>{name}</option>)}
          </Select>
        </Field>
        {platform === "Other" ? <Field label="Platform name"><TextInput value={custom} onChange={(event) => setCustom(event.target.value)} maxLength={40} required /></Field> : null}
        <Field label="Format">
          <Select value={format} onChange={(event) => setFormat(event.target.value)}>
            <option value="">Format open</option>
            {FORMATS.map((name) => <option key={name} value={name}>{name}</option>)}
          </Select>
        </Field>
        <Field label="Caption"><TextArea maxLength={500} value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="The line that goes with the post." /></Field>
        <Field label="Notes"><TextArea maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Account, hashtags, or anything the studio should keep." /></Field>
        <Field label="Live URL"><TextInput type="url" value={url} onChange={(event) => setUrl(event.target.value)} required /></Field>
        {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
        <div className="mt-4 flex gap-2"><Button type="submit">Publish</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
      </form>
    </Modal>
  );
}

function ReachDialog({ item, zone, onClose, onSubmit }: { item: PublishItem; zone?: string; onClose: () => void; onSubmit: (body: { views: number; likes: number; recordedOn: string; note?: string }) => void }) {
  const [views, setViews] = useState(item.metricsUpdatedAt ? String(item.viewCount ?? 0) : "");
  const [likes, setLikes] = useState(item.metricsUpdatedAt ? String(item.likeCount ?? 0) : "");
  const [recordedOn, setRecordedOn] = useState(todayKey(zone ?? "Asia/Kolkata"));
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const history = item.readings ?? [];
  return (
    <Modal title={`Reach · ${item.deliverable?.title || item.platform}`} onClose={onClose}>
      <form onSubmit={(event) => {
        event.preventDefault();
        const viewCount = Number(views.trim());
        const likeCount = Number(likes.trim());
        if (views.trim() === "" || likes.trim() === "" || !Number.isInteger(viewCount) || viewCount < 0 || !Number.isInteger(likeCount) || likeCount < 0) {
          setError("Enter views and likes as whole numbers.");
          return;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(recordedOn)) {
          setError("Choose the date you checked the post.");
          return;
        }
        setError("");
        onSubmit({ views: viewCount, likes: likeCount, recordedOn, note: note.trim() || undefined });
      }}>
        <p className="mb-3 text-sm text-muted">{item.clientName || "Client"} · {item.projectName || "Project"} · {item.platform}. Saving keeps this reading and sets the current views and likes.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Views"><TextInput inputMode="numeric" value={views} onChange={(event) => setViews(event.target.value)} required /></Field>
          <Field label="Likes"><TextInput inputMode="numeric" value={likes} onChange={(event) => setLikes(event.target.value)} required /></Field>
        </div>
        <Field label="Date checked"><TextInput type="date" value={recordedOn} onChange={(event) => setRecordedOn(event.target.value)} required /></Field>
        <Field label="Note"><TextInput maxLength={160} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional. What you noticed on the platform." /></Field>
        {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
        <div className="mt-4 flex gap-2"><Button type="submit">Save reach</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
        {history.length ? (
          <div className="mt-5">
            <h3 className="text-sm font-medium">Earlier readings</h3>
            <ul className="mt-2">
              {history.map((reading, index) => (
                <li key={`${reading.recordedAt ?? reading.recordedOn}-${index}`} className="border-b border-line py-2 text-sm">
                  <span className="num">{tally(reading.views)} views</span> · <span className="num">{tally(reading.likes)} likes</span>
                  <span className="text-muted"> · {reading.recordedOn}{reading.note ? ` · ${reading.note}` : ""}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}

function Ask({ title, detail, label, submitLabel, onClose, onSubmit, inputType = "text" }: { title: string; detail?: string; label: string; submitLabel: string; onClose: () => void; onSubmit: (value: string) => void; inputType?: string }) {
  const [value, setValue] = useState("");
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={(event) => { event.preventDefault(); if (value.trim()) onSubmit(value.trim()); }}>
        {detail ? <p className="mb-3 text-sm text-muted">{detail}</p> : null}
        <Field label={label}>{inputType === "textarea" ? <TextArea value={value} onChange={(event) => setValue(event.target.value)} /> : <TextInput type={inputType} value={value} onChange={(event) => setValue(event.target.value)} required />}</Field>
        <div className="mt-4 flex gap-2"><Button type="submit">{submitLabel}</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
      </form>
    </Modal>
  );
}

function ReassignDialog({ people, onClose, onSubmit }: { people: Array<{ userId?: string; firstName: string; lastName: string; designation?: string }>; onClose: () => void; onSubmit: (userId: string, reason: string) => void }) {
  const [toUserId, setToUserId] = useState("");
  const [reason, setReason] = useState("");
  return (
    <Modal title="Reassign the cut" onClose={onClose}>
      <form onSubmit={(event) => { event.preventDefault(); if (toUserId && reason.trim()) onSubmit(toUserId, reason.trim()); }}>
        <Field label="Editor">
          <Select value={toUserId} onChange={(event) => setToUserId(event.target.value)} required>
            <option value="">Select</option>
            {people.map((person) => <option key={person.userId} value={person.userId}>{person.firstName} {person.lastName}{person.designation ? ` · ${person.designation}` : ""}</option>)}
          </Select>
        </Field>
        <Field label="Reason"><TextArea value={reason} onChange={(event) => setReason(event.target.value)} required /></Field>
        <div className="mt-4 flex gap-2"><Button type="submit">Reassign</Button><Button variant="ghost" onClick={onClose}>Cancel</Button></div>
      </form>
    </Modal>
  );
}

function PublishCalendar({ items }: { items: PublishItem[] }) {
  const days = Array.from({ length: 30 }, (_, index) => {
    const date = new Date();
    date.setDate(index + 1);
    const key = date.toISOString().slice(0, 10);
    return { key, label: date.getDate(), items: items.filter((item) => item.scheduledAt?.slice(0, 10) === key) };
  });
  return <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-5">{days.map((day) => <div key={day.key} className="min-h-24 bg-white p-2"><div className="num text-xs text-muted">{day.label}</div>{day.items.map((item) => <div key={item._id} className="mt-1 text-xs"><div className="font-medium">{item.deliverable?.title || item.platform}</div><div className="text-muted">{item.projectName || item.platform}</div><Status value={item.status} /></div>)}</div>)}</div>;
}
