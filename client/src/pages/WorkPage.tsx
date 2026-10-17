import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { todayKey } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { Button, LoadingRows, Notice, PageHeader, Select, TextInput } from "@/components/ui";

type Person = {
  id: string;
  code: string;
  name: string;
  role: string;
  slug: string;
  shoots: number;
  shootsDone: number;
  edits: number;
  editsDone: number;
  posts: number;
  postsDone: number;
  reviews: number;
  plans: number;
  daysPresent: number;
  hours: number;
};
type EventRow = {
  id: string;
  dateKey: string;
  time: string;
  personId: string;
  personName: string;
  role: string;
  kind: string;
  project: string;
  client: string;
  code: string;
  title: string;
  location: string;
  notes: string;
  hours: string;
  status: string;
};
type Report = { span: string; from: string; to: string; scope: "studio" | "self"; roster: Person[]; people: Person[]; timeline: EventRow[] };

function shiftKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function shiftMonth(dateKey: string, delta: number) {
  let year = Number(dateKey.slice(0, 4));
  let month = Number(dateKey.slice(5, 7)) + delta;
  while (month < 1) { month += 12; year -= 1; }
  while (month > 12) { month -= 12; year += 1; }
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function pretty(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

function line(person: Person) {
  if (person.slug === "cinematographer") return `${person.shootsDone} shoots done · ${person.shoots} out · ${person.hours}h`;
  if (person.slug === "video-editor") return `${person.editsDone} edits finished · ${person.edits} in hand · ${person.hours}h`;
  if (person.slug === "social-media-manager") return `${person.postsDone} posts published · ${person.posts} assigned`;
  if (person.slug === "team-lead") return `${person.reviews} reviews · ${person.plans} plans done`;
  if (person.slug === "floor-staff") return `${person.daysPresent} days in · ${person.plans} plans done`;
  return `${person.shootsDone} shoots · ${person.editsDone} edits · ${person.postsDone} posts · ${person.hours}h`;
}

function WorkDetail({ person, rows, onClose }: { person: Person; rows: EventRow[]; onClose: () => void }) {
  const projects = useMemo(() => {
    const groups = new Map<string, EventRow[]>();
    for (const row of rows) {
      const key = row.project || "No project";
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }
    return [...groups.entries()];
  }, [rows]);

  return (
    <section className="mb-6 border border-ink bg-white">
      <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-4">
        <div>
          <h2 className="text-lg font-medium">{person.name}</h2>
          <p className="text-sm text-muted">{person.role}{person.code ? ` · Staff ID ${person.code}` : ""}</p>
          <p className="mt-2 text-sm">{line(person)}</p>
        </div>
        <button className="text-sm text-muted" type="button" onClick={onClose}>Close</button>
      </div>
      {!rows.length ? <p className="px-4 py-6 text-sm text-muted">Nothing recorded for this staff ID in this period.</p> : null}
      {projects.map(([project, items]) => (
        <div key={project}>
          <h3 className="border-b border-line bg-paper px-4 py-3 font-medium">{project}</h3>
          <ol>
            {items.map((row) => (
              <li key={row.id} className="border-b border-line px-4 py-3 last:border-b-0">
                <div className="text-sm text-muted">{pretty(row.dateKey)}{row.time ? ` · ${row.time}` : ""}</div>
                <div className="font-medium">{row.kind}{row.code ? ` · ${row.code}` : ""} · {row.title}</div>
                <div className="text-sm text-muted">{[row.client, row.location].filter(Boolean).join(" · ")}</div>
                <div className="text-sm">{[row.status, row.hours, row.notes].filter(Boolean).join(" · ")}</div>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}

export function WorkPage() {
  const { user } = useAuth();
  const zone = user?.studio?.businessTimezone ?? "Asia/Kolkata";
  const [span, setSpan] = useState<"day" | "week" | "month">("day");
  const [date, setDate] = useState(todayKey(zone));
  const [person, setPerson] = useState("");
  const [openId, setOpenId] = useState("");
  const report = useQuery({
    queryKey: ["work", span, date, person],
    queryFn: async () => (await api.get("/work", { params: { span, date, person } })).data.data as Report,
  });
  const data = report.data;
  const shown = data?.people ?? [];
  const openPerson = shown.find((item) => item.id === openId) ?? null;
  const openRows = useMemo(() => (data?.timeline ?? []).filter((row) => row.personId === openId), [data?.timeline, openId]);
  const days = useMemo(() => {
    const groups = new Map<string, EventRow[]>();
    for (const row of data?.timeline ?? []) {
      const list = groups.get(row.dateKey) ?? [];
      list.push(row);
      groups.set(row.dateKey, list);
    }
    return [...groups.entries()];
  }, [data?.timeline]);
  const label = data ? data.from === data.to ? pretty(data.from) : `${pretty(data.from)} – ${pretty(data.to)}` : "";

  function move(delta: number) {
    setDate(span === "month" ? shiftMonth(date, delta) : shiftKey(date, delta * (span === "week" ? 7 : 1)));
  }

  function choose(id: string) {
    setPerson(id);
    setOpenId("");
  }

  return (
    <div>
      <PageHeader eyebrow="People" title="Work" text={data?.scope === "studio" ? "Pick a person to see only their work. Open their card for every project, shoot, and edit on their staff ID." : "Your day, week, and month. Open the card for every project and shoot on your staff ID."} />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="flex gap-2">
          {(["day", "week", "month"] as const).map((item) => (
            <Button key={item} variant={span === item ? "ink" : "ghost"} onClick={() => setSpan(item)}>{item[0].toUpperCase()}{item.slice(1)}</Button>
          ))}
        </div>
        <Button variant="ghost" onClick={() => move(-1)}>Previous</Button>
        <Button variant="ghost" onClick={() => move(1)}>Next</Button>
        <TextInput className="w-40" type="date" aria-label="Report date" value={date} onChange={(event) => setDate(event.target.value)} />
        {data?.scope === "studio" ? (
          <Select aria-label="Person" value={person} onChange={(event) => choose(event.target.value)}>
            <option value="">Everyone</option>
            {(data.roster ?? data.people ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
        ) : null}
      </div>
      {label ? <p className="mb-4 text-sm text-muted">{label}</p> : null}
      {report.isLoading ? <LoadingRows /> : null}
      {report.isError ? <Notice tone="danger">{errorMessage(report.error)}</Notice> : null}
      {data && !data.roster?.length && data.scope === "self" ? <Notice>This login is not linked to a person, so there is no work report yet.</Notice> : null}
      {openPerson ? <WorkDetail person={openPerson} rows={openRows} onClose={() => setOpenId("")} /> : null}
      {shown.length && !openPerson ? (
        <div className={`mb-6 grid gap-3 ${person ? "" : "sm:grid-cols-2 xl:grid-cols-3"}`}>
          {shown.map((item) => (
            <button key={item.id} className="border border-line bg-white p-4 text-left" type="button" onClick={() => setOpenId(item.id)}>
              <div className="font-medium">{item.name}</div>
              <div className="text-sm text-muted">{item.role}{item.code ? ` · ${item.code}` : ""}</div>
              <p className="mt-2 text-sm">{line(item)}</p>
              <p className="mt-1 text-xs text-muted">{item.daysPresent} days in{item.reviews ? ` · ${item.reviews} reviews` : ""}{item.plans ? ` · ${item.plans} plans` : ""}</p>
              <p className="mt-3 text-sm">Open detail</p>
            </button>
          ))}
        </div>
      ) : null}
      {data && !openPerson && !days.length && shown.length ? <p className="text-sm text-muted">Nothing recorded in this period.</p> : null}
      {!openPerson ? days.map(([day, rows]) => (
        <section key={day} className="mb-4 border border-line bg-white">
          <h2 className="border-b border-line px-4 py-3 font-medium">{pretty(day)}</h2>
          <ol>
            {rows.map((row) => (
              <li key={row.id}>
                <button className="grid w-full grid-cols-[4.5rem_minmax(0,1fr)] gap-3 border-b border-line px-4 py-3 text-left last:border-b-0" type="button" onClick={() => setOpenId(row.personId)}>
                  <div className="text-sm text-muted">{row.time || "—"}</div>
                  <div>
                    <div className="font-medium">{row.kind}{row.code ? ` · ${row.code}` : ""} · {row.title}</div>
                    <div className="text-sm text-muted">{data?.scope === "studio" && !person ? `${row.personName} · ` : ""}{[row.client, row.project, row.location].filter(Boolean).join(" · ")}</div>
                    <div className="text-sm">{[row.status, row.hours].filter(Boolean).join(" · ")}</div>
                  </div>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )) : null}
    </div>
  );
}
