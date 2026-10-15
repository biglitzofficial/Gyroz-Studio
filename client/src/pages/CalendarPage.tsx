import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { todayKey } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { Button, Empty, Field, LoadingRows, Modal, PageHeader, SaveAction, Select, TextArea, TextInput } from "@/components/ui";

type PlanItem = {
  id: string;
  kind: "shoot" | "editing" | "publishing" | "other";
  title: string;
  dateKey: string;
  startTime: string;
  endTime?: string;
  assigneeName: string;
  projectName?: string;
  location?: string;
  notes?: string;
  status: string;
  source: "plan" | "shoot";
};

const kinds = [
  ["shoot", "Shooting"],
  ["editing", "Editing"],
  ["publishing", "Publishing"],
  ["other", "Other"],
] as const;

function monthCells(anchor: string) {
  const [year, month] = anchor.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(year, month - 1, 1 - offset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { key, day: date.getDate(), inMonth: date.getMonth() === month - 1 };
  });
}

function shiftMonth(anchor: string, delta: number) {
  const [year, month] = anchor.split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function CalendarPage() {
  const { can, user } = useAuth();
  const zone = user?.studio?.businessTimezone ?? "Asia/Kolkata";
  const today = todayKey(zone);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [draftDate, setDraftDate] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const cells = useMemo(() => monthCells(`${month}-01`), [month]);
  const queryClient = useQueryClient();
  const plans = useQuery({
    queryKey: ["plans", cells[0].key, cells[41].key],
    queryFn: async () => (await api.get("/plans", { params: { from: cells[0].key, to: cells[41].key } })).data.data as PlanItem[],
  });
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: async () => (await api.get("/projects")).data.data as Array<{ _id: string; name: string }>,
    enabled: can("plans.assign"),
  });
  const save = useMutation({
    meta: { loading: "Assigning", toast: "Plan assigned. It will show on that person's dashboard." },
    mutationFn: async (body: Record<string, string>) => api.post("/plans", body),
    onSuccess: () => {
      setDraftDate(null);
      setMessage("Plan assigned. It will show on that person's dashboard.");
      queryClient.invalidateQueries({ queryKey: ["plans"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => setMessage(errorMessage(error)),
  });
  const remove = useMutation({
    meta: { loading: "Removing", toast: "Removed from the calendar." },
    mutationFn: async (item: PlanItem) => api.post(item.source === "plan" ? `/plans/${item.id}/cancel` : `/shoots/${item.id}/cancel`),
    onSuccess: () => {
      setMessage("Removed from the calendar.");
      queryClient.invalidateQueries({ queryKey: ["plans"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["shoots"] });
    },
    onError: (error) => setMessage(errorMessage(error)),
  });
  const byDay = new Map<string, PlanItem[]>();
  for (const item of plans.data ?? []) {
    const list = byDay.get(item.dateKey) ?? [];
    list.push(item);
    byDay.set(item.dateKey, list);
  }
  const label = new Date(`${month}-01T00:00:00`).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  return (
    <div>
      <PageHeader
        eyebrow="Schedule"
        title="Calendar"
        text={can("plans.assign") ? "Click a day to see everything assigned. You can add another plan from that day." : "Click a day to see everything assigned to you."}
        actions={
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <Button variant="ghost" onClick={() => setMonth(shiftMonth(month, -1))}>Previous</Button>
            <div className="min-w-0 flex-1 text-center text-sm font-medium sm:min-w-32 sm:flex-none">{label}</div>
            <Button variant="ghost" onClick={() => setMonth(shiftMonth(month, 1))}>Next</Button>
          </div>
        }
      />
      {message ? <p className="mb-3 text-sm">{message}</p> : null}
      {plans.isLoading ? <LoadingRows /> : null}
      {plans.isError ? <Empty title="Calendar unavailable" text={errorMessage(plans.error)} /> : null}
      {plans.data ? (
        <div className="month-grid border border-line bg-white">
          <div className="grid grid-cols-7 border-b border-line text-[11px] uppercase tracking-[0.14em] text-muted">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <div key={day} className="px-1 py-2 text-center sm:px-2 sm:text-left">{day.slice(0, 1)}<span className="hidden sm:inline">{day.slice(1)}</span></div>)}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((cell) => {
              const items = byDay.get(cell.key) ?? [];
              return (
                <button
                  key={cell.key}
                  type="button"
                  aria-label={`${cell.key}, ${items.length} assigned`}
                  className={`relative min-h-28 border-b border-r border-line p-2 text-left align-top ${cell.inMonth ? "bg-white" : "bg-paper text-muted"} ${cell.key === today ? "shadow-[inset_0_2px_0_#FFD500]" : ""}`}
                  onClick={() => setSelectedDate(cell.key)}
                >
                  <div className="num text-xs">{cell.day}</div>
                  {items.length ? <span className="month-mark absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 bg-ink" /> : null}
                  <div className="month-detail mt-1 space-y-1">
                    {items.slice(0, 3).map((item) => (
                      <div key={`${item.source}-${item.id}`} className="border-l-2 border-accent bg-paper px-1.5 py-1">
                        <div className="text-[10px] uppercase tracking-[0.12em] text-muted">{kinds.find(([key]) => key === item.kind)?.[1]} · {item.startTime}</div>
                        <div className="truncate text-xs font-medium">{item.title}</div>
                        <div className="truncate text-[11px] text-muted">{item.assigneeName}</div>
                        {can("plans.assign") ? (
                          <button className="mt-1 text-[11px] text-danger" type="button" onClick={(event) => { event.stopPropagation(); remove.mutate(item); }}>Delete</button>
                        ) : null}
                      </div>
                    ))}
                    {items.length > 3 ? <div className="text-[11px] text-muted">+{items.length - 3} more</div> : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      {selectedDate ? (
        <DayAssignments
          dateKey={selectedDate}
          items={byDay.get(selectedDate) ?? []}
          canAssign={can("plans.assign")}
          onAssign={() => setDraftDate(selectedDate)}
          removing={remove.isPending}
          onDelete={(item) => remove.mutate(item)}
          onClose={() => setSelectedDate(null)}
        />
      ) : null}
      {draftDate ? (
        <AssignPlan
          dateKey={draftDate}
          projects={projects.data ?? []}
          pending={save.isPending}
          onClose={() => setDraftDate(null)}
          onSubmit={(body) => save.mutate(body)}
        />
      ) : null}
    </div>
  );
}

function DayAssignments({ dateKey, items, canAssign, removing, onAssign, onDelete, onClose }: {
  dateKey: string;
  items: PlanItem[];
  canAssign: boolean;
  removing: boolean;
  onAssign: () => void;
  onDelete: (item: PlanItem) => void;
  onClose: () => void;
}) {
  const heading = new Date(`${dateKey}T00:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const ordered = [...items].sort((a, b) => a.startTime.localeCompare(b.startTime) || a.title.localeCompare(b.title));
  return (
    <Modal title={heading} onClose={onClose}>
      {ordered.length ? (
        <ul className="divide-y divide-line border border-line">
          {ordered.map((item) => (
            <li key={`${item.source}-${item.id}`} className="px-3 py-3 text-sm">
              <div className="text-[11px] uppercase tracking-[0.12em] text-muted">{kinds.find(([key]) => key === item.kind)?.[1]} · {item.startTime}{item.endTime ? `–${item.endTime}` : ""}</div>
              <div className="mt-1 font-medium">{item.title}</div>
              <div className="mt-1 text-muted">{item.assigneeName}{item.projectName ? ` · ${item.projectName}` : ""}{item.location ? ` · ${item.location}` : ""}</div>
              {item.notes ? <p className="mt-1 text-muted">{item.notes}</p> : null}
              {canAssign ? (
                <Button className="mt-3" size="sm" variant="danger" disabled={removing} onClick={() => onDelete(item)}>Delete</Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted">Nothing is assigned on this day.</p>}
      {canAssign ? <Button className="mt-4" onClick={onAssign}>Assign on this day</Button> : null}
    </Modal>
  );
}

function AssignPlan({ dateKey, projects, pending, onClose, onSubmit }: {
  dateKey: string;
  projects: Array<{ _id: string; name: string }>;
  pending: boolean;
  onClose: () => void;
  onSubmit: (body: Record<string, string>) => void;
}) {
  const [kind, setKind] = useState("shoot");
  const assign = kind === "shoot" ? "camera" : kind === "editing" ? "editor" : kind === "publishing" ? "publisher" : "";
  const people = useQuery({
    queryKey: ["employees", "assign", assign || "any"],
    queryFn: async () => (await api.get("/employees", { params: { status: "active", limit: 100, ...(assign ? { assign } : {}) } })).data.data as Array<{ _id: string; firstName: string; lastName: string; designation?: string }>,
  });
  const [title, setTitle] = useState("");
  const [assigneeEmployeeId, setAssignee] = useState("");
  const [projectId, setProjectId] = useState("");
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("18:00");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <Modal title={`Assign ${dateKey}`} onClose={onClose}>
      <form className="grid gap-3" onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ kind, title, dateKey, assigneeEmployeeId, projectId, startTime, endTime, location, notes });
      }}>
        <Field label="Type">
          <Select value={kind} onChange={(event) => { setKind(event.target.value); setAssignee(""); }}>
            {kinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </Field>
        <Field label="Title"><TextInput maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} required /></Field>
        <Field label="Staff">
          <Select value={assigneeEmployeeId} onChange={(event) => setAssignee(event.target.value)} required>
            <option value="">Select</option>
            {(people.data ?? []).map((person) => <option key={person._id} value={person._id}>{person.firstName} {person.lastName}{person.designation ? ` · ${person.designation}` : ""}</option>)}
          </Select>
        </Field>
        <Field label={kind === "shoot" ? "Project" : "Project, if it belongs to one"}>
          <Select value={projectId} onChange={(event) => setProjectId(event.target.value)} required={kind === "shoot"}>
            <option value="">{kind === "shoot" ? "Select" : "None"}</option>
            {projects.map((project) => <option key={project._id} value={project._id}>{project.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start"><TextInput type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></Field>
          <Field label="End"><TextInput type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></Field>
        </div>
        <Field label="Location"><TextInput value={location} onChange={(event) => setLocation(event.target.value)} /></Field>
        <Field label="Notes"><TextArea value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
        <div className="flex gap-2">
          <SaveAction changed pending={pending} label="Assign" />
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}
