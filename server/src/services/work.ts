import type { AuthContext } from "../auth";
import { businessDateKey, monthBounds, weekdayOfKey } from "../domain/dates";
import { AppError } from "../http";
import { Attendance, Client, Deliverable, EditingTask, Employee, Plan, Project, PublishingTask, Review, Role, Shoot } from "../models";
import { studioTimezone } from "../platform";

type Span = "day" | "week" | "month";

function shiftKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function period(span: Span, anchor: string, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) throw new AppError(400, "VALIDATION", "Choose a date.");
  if (span === "day") return { from: anchor, to: anchor };
  if (span === "week") {
    const weekday = weekdayOfKey(anchor, timeZone);
    const back = weekday === 0 ? 6 : weekday - 1;
    const from = shiftKey(anchor, -back);
    return { from, to: shiftKey(from, 6) };
  }
  const bounds = monthBounds(anchor.slice(0, 7));
  return { from: bounds.start, to: bounds.end };
}

function dayKey(value: unknown, timeZone: string) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return businessDateKey(date, timeZone);
}

function clockOf(value: unknown, timeZone: string) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

function inSpan(key: string, from: string, to: string) {
  return Boolean(key) && key >= from && key <= to;
}

function hoursLabel(hours: number) {
  if (!hours) return "";
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded}h`;
}

export async function workReport(auth: AuthContext, input: { span?: string; date?: string; person?: string }) {
  const span: Span = input.span === "week" || input.span === "month" ? input.span : "day";
  const timeZone = await studioTimezone();
  const anchor = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : businessDateKey(new Date(), timeZone);
  const { from, to } = period(span, anchor, timeZone);
  const studio = auth.isSuperAdmin;
  const employees = await Employee.find({ employmentStatus: { $in: ["active", "on_leave"] } }).lean() as any[];
  const mine = employees.find((person) => String(person._id) === auth.employeeId);
  if (!studio && !mine) {
    return { span, from, to, scope: "self" as const, roster: [], people: [], timeline: [] };
  }
  const visible = studio ? employees : [mine];
  const focus = studio && input.person ? visible.filter((person) => String(person._id) === input.person) : visible;
  const focusIds = new Set(focus.map((person) => String(person._id)));
  const roles = await Role.find({}).select("name slug").lean() as any[];
  const roleName = new Map(roles.map((role) => [String(role._id), { name: role.name as string, slug: role.slug as string }]));
  const [shoots, tasks, posts, reviews, plans, punches, projects, clients, deliverables] = await Promise.all([
    Shoot.find({ scheduledDate: { $gte: from, $lte: to }, status: { $ne: "cancelled" } }).lean() as any,
    EditingTask.find({}).lean() as any,
    PublishingTask.find({}).lean() as any,
    Review.find({}).lean() as any,
    Plan.find({ dateKey: { $gte: from, $lte: to }, status: { $ne: "cancelled" } }).lean() as any,
    Attendance.find({ dateKey: { $gte: from, $lte: to } }).lean() as any,
    Project.find({}).select("name projectCode").lean() as any,
    Client.find({}).select("name").lean() as any,
    Deliverable.find({}).select("title deliverableCode projectId clientId").lean() as any,
  ]);
  const projectName = new Map<string, string>(projects.map((item) => [String(item._id), item.projectCode ? `${item.projectCode} · ${item.name}` : String(item.name || "")]));
  const clientName = new Map<string, string>(clients.map((item) => [String(item._id), String(item.name || "")]));
  const deliverableName = new Map<string, string>(deliverables.map((item) => [String(item._id), String(item.title || "")]));
  const deliverableCode = new Map<string, string>(deliverables.map((item) => [String(item._id), String(item.deliverableCode || "")]));
  const deliverableProject = new Map<string, string>(deliverables.map((item) => [String(item._id), String(item.projectId || "")]));
  const deliverableClient = new Map<string, string>(deliverables.map((item) => [String(item._id), String(item.clientId || "")]));
  const peopleById = new Map(visible.map((person) => [String(person._id), person]));
  const peopleByUser = new Map(visible.filter((person) => person.userId).map((person) => [String(person.userId), person]));

  type Row = {
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
  const timeline: Row[] = [];
  const blank = () => ({ shoots: 0, shootsDone: 0, edits: 0, editsDone: 0, editHours: 0, posts: 0, postsDone: 0, reviews: 0, plans: 0, daysPresent: 0, shootHours: 0 });
  const totals = new Map<string, ReturnType<typeof blank>>();
  for (const person of visible) totals.set(String(person._id), blank());

  function add(person: any, row: Omit<Row, "personId" | "personName" | "role">) {
    const id = String(person._id);
    if (!focusIds.has(id)) return;
    const role = roleName.get(String(person.roleId));
    timeline.push({
      ...row,
      personId: id,
      personName: `${person.firstName} ${person.lastName}`.trim(),
      role: role?.name || person.designation || "Staff",
    });
  }

  for (const shoot of shoots) {
    const camera = peopleById.get(String(shoot.cinematographerId));
    const done = shoot.status === "submitted";
    const went = shoot.status === "submitted" || shoot.status === "in_progress";
    if (camera && went) {
      const bucket = totals.get(String(camera._id));
      if (bucket) {
        bucket.shoots += 1;
        if (done) bucket.shootsDone += 1;
        bucket.shootHours += Number(shoot.hoursSpent) || 0;
      }
    }
    const crew = new Set<string>([String(shoot.cinematographerId), ...(shoot.crewIds ?? []).map(String)]);
    for (const memberId of crew) {
      const person = peopleById.get(memberId);
      if (!person) continue;
      const lead = memberId === String(shoot.cinematographerId);
      add(person, {
        id: `shoot-${shoot._id}-${memberId}`,
        dateKey: String(shoot.scheduledDate || ""),
        time: String(shoot.plannedStart || clockOf(shoot.actualStart, timeZone)),
        kind: lead ? "Shoot" : "Crew",
        project: projectName.get(String(shoot.projectId)) || "",
        client: clientName.get(String(shoot.clientId)) || "",
        code: String(shoot.shootCode || ""),
        title: String(shoot.location || shoot.shootCode || "Shoot"),
        location: String(shoot.location || ""),
        notes: [shoot.brief, shoot.report, shoot.notes].map((part) => String(part || "").trim()).filter(Boolean).join(" · "),
        hours: hoursLabel(lead ? Number(shoot.hoursSpent) || 0 : 0),
        status: String(shoot.status || "").replaceAll("_", " "),
      });
    }
  }

  for (const task of tasks) {
    const person = peopleByUser.get(String(task.claimedBy || ""));
    if (!person) continue;
    const stamp = [task.completedAt, task.submittedAt, task.startedAt, task.claimedAt].map((value) => dayKey(value, timeZone)).find((key) => inSpan(key, from, to));
    if (!stamp) continue;
    const when = task.completedAt && inSpan(dayKey(task.completedAt, timeZone), from, to) ? task.completedAt
      : task.submittedAt && inSpan(dayKey(task.submittedAt, timeZone), from, to) ? task.submittedAt
        : task.startedAt && inSpan(dayKey(task.startedAt, timeZone), from, to) ? task.startedAt
          : task.claimedAt;
    const done = ["submitted", "approved"].includes(task.status);
    const bucket = totals.get(String(person._id));
    if (bucket) {
      bucket.edits += 1;
      if (done) bucket.editsDone += 1;
      bucket.editHours += Number(task.hoursSpent) || 0;
    }
    add(person, {
      id: `edit-${task._id}`,
      dateKey: stamp,
      time: clockOf(when, timeZone),
      kind: "Edit",
      project: projectName.get(String(task.projectId)) || "",
      client: clientName.get(String(task.clientId)) || "",
      code: deliverableCode.get(String(task.deliverableId)) || "",
      title: deliverableName.get(String(task.deliverableId)) || "Edit",
      location: "",
      notes: [task.workNotes, task.outcome, task.holdReason].map((part) => String(part || "").trim()).filter(Boolean).join(" · "),
      hours: hoursLabel(Number(task.hoursSpent) || 0),
      status: String(task.status || "").replaceAll("_", " "),
    });
  }

  for (const post of posts) {
    const person = peopleByUser.get(String(post.assignedTo || ""));
    if (!person) continue;
    const stamp = inSpan(dayKey(post.publishedAt, timeZone), from, to) ? dayKey(post.publishedAt, timeZone) : inSpan(dayKey(post.scheduledAt, timeZone), from, to) ? dayKey(post.scheduledAt, timeZone) : "";
    if (!stamp) continue;
    const done = post.status === "published";
    const bucket = totals.get(String(person._id));
    if (bucket) {
      bucket.posts += 1;
      if (done) bucket.postsDone += 1;
    }
    add(person, {
      id: `post-${post._id}`,
      dateKey: stamp,
      time: clockOf(post.publishedAt || post.scheduledAt, timeZone),
      kind: "Post",
      project: projectName.get(String(post.projectId)) || "",
      client: clientName.get(String(post.clientId)) || "",
      code: deliverableCode.get(String(post.deliverableId)) || "",
      title: `${deliverableName.get(String(post.deliverableId)) || "Post"} · ${post.platform}`,
      location: "",
      notes: [post.caption, post.publishedUrl, post.notes].map((part) => String(part || "").trim()).filter(Boolean).join(" · "),
      hours: "",
      status: String(post.status || "").replaceAll("_", " "),
    });
  }

  for (const review of reviews) {
    const person = peopleByUser.get(String(review.reviewerId || ""));
    if (!person) continue;
    const stamp = dayKey(review.createdAt, timeZone);
    if (!inSpan(stamp, from, to)) continue;
    const bucket = totals.get(String(person._id));
    if (bucket) bucket.reviews += 1;
    add(person, {
      id: `review-${review._id}`,
      dateKey: stamp,
      time: clockOf(review.createdAt, timeZone),
      kind: "Review",
      project: projectName.get(deliverableProject.get(String(review.deliverableId)) || "") || "",
      client: clientName.get(deliverableClient.get(String(review.deliverableId)) || "") || "",
      code: deliverableCode.get(String(review.deliverableId)) || "",
      title: deliverableName.get(String(review.deliverableId)) || "Review",
      location: "",
      notes: String(review.feedback || ""),
      hours: "",
      status: String(review.decision || ""),
    });
  }

  for (const plan of plans) {
    const person = peopleById.get(String(plan.assigneeEmployeeId));
    if (!person) continue;
    const bucket = totals.get(String(person._id));
    if (bucket && plan.status === "done") bucket.plans += 1;
    add(person, {
      id: `plan-${plan._id}`,
      dateKey: String(plan.dateKey || ""),
      time: String(plan.startTime || ""),
      kind: "Plan",
      project: projectName.get(String(plan.projectId)) || "",
      client: clientName.get(String(plan.clientId)) || "",
      code: String(plan.planCode || ""),
      title: String(plan.title || "Plan"),
      location: String(plan.location || ""),
      notes: String(plan.notes || ""),
      hours: "",
      status: String(plan.status || ""),
    });
  }

  for (const punch of punches) {
    const person = peopleById.get(String(punch.employeeId));
    if (!person || !punch.checkInAt) continue;
    const bucket = totals.get(String(person._id));
    if (bucket) bucket.daysPresent += 1;
    const inn = clockOf(punch.checkInAt, timeZone);
    const out = punch.checkOutAt ? clockOf(punch.checkOutAt, timeZone) : "";
    add(person, {
      id: `attendance-${punch._id}`,
      dateKey: String(punch.dateKey || ""),
      time: inn,
      kind: "Attendance",
      project: "",
      client: "",
      code: "",
      title: out ? `${inn}–${out}` : `In ${inn}`,
      location: "",
      notes: punch.minutes ? `${Math.floor(punch.minutes / 60)}h ${punch.minutes % 60}m` : "",
      hours: "",
      status: punch.late ? "late" : "on time",
    });
  }

  timeline.sort((left, right) => right.dateKey.localeCompare(left.dateKey) || right.time.localeCompare(left.time));
  const roster = visible.map((person) => {
    const role = roleName.get(String(person.roleId));
    const count = totals.get(String(person._id)) ?? blank();
    return {
      id: String(person._id),
      code: String(person.employeeCode || ""),
      name: `${person.firstName} ${person.lastName}`.trim(),
      role: role?.name || person.designation || "Staff",
      slug: role?.slug || "",
      shoots: count.shoots,
      shootsDone: count.shootsDone,
      edits: count.edits,
      editsDone: count.editsDone,
      posts: count.posts,
      postsDone: count.postsDone,
      reviews: count.reviews,
      plans: count.plans,
      daysPresent: count.daysPresent,
      hours: Math.round((count.shootHours + count.editHours) * 10) / 10,
    };
  }).sort((left, right) => right.hours - left.hours || left.name.localeCompare(right.name));
  const people = studio && input.person ? roster.filter((person) => person.id === input.person) : roster;

  return { span, from, to, scope: studio ? "studio" as const : "self" as const, roster, people, timeline: timeline.slice(0, 400) };
}
