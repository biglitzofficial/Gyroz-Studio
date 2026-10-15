import { assertClientAccess, hasPermission, scopeFilter, type AuthContext } from "../auth";
import { businessDateKey } from "../domain/dates";
import { AppError } from "../http";
import { Employee, Plan, Project, Shoot } from "../models";
import { audit, nextCode, notify, studioTimezone } from "../platform";
import { createShoot } from "./production";
import { assertAssignable } from "./people";

const KINDS = ["shoot", "editing", "publishing", "other"] as const;

export async function listPlans(auth: AuthContext, query: Record<string, unknown>) {
  const manage = hasPermission(auth, "plans.assign");
  const from = typeof query.from === "string" ? query.from : "";
  const to = typeof query.to === "string" ? query.to : "";
  const planFilter: Record<string, unknown> = { status: { $ne: "cancelled" } };
  const date: Record<string, string> = {};
  if (from) date.$gte = from;
  if (to) date.$lte = to;
  if (from || to) planFilter.dateKey = { ...date };
  if (!manage) {
    if (!auth.employeeId) return [];
    planFilter.assigneeEmployeeId = auth.employeeId;
  }
  const plans = await Plan.find(planFilter).sort({ dateKey: 1, startTime: 1 }).limit(200).lean() as any;
  const shootFilter: Record<string, unknown> = { status: { $ne: "cancelled" }, ...scopeFilter(auth) };
  if (from || to) shootFilter.scheduledDate = { ...date };
  if (!manage) {
    if (!auth.employeeId) return present(plans, []);
    shootFilter.cinematographerId = auth.employeeId;
  }
  const shoots = await Shoot.find(shootFilter).sort({ scheduledDate: 1 }).limit(200).lean() as any;
  return present(plans, shoots);
}

async function present(plans: any[], shoots: any[]) {
  const linked = new Set(plans.map((plan) => (plan.shootId ? String(plan.shootId) : "")).filter(Boolean));
  const employees = await Employee.find({
    _id: { $in: [...plans.map((plan) => plan.assigneeEmployeeId), ...shoots.map((shoot) => shoot.cinematographerId)] },
  }).select("firstName lastName").lean() as any;
  const projects = await Project.find({
    _id: { $in: [...plans.map((plan) => plan.projectId), ...shoots.map((shoot) => shoot.projectId)].filter(Boolean) },
  }).select("name").lean() as any;
  const person = new Map(employees.map((employee) => [String(employee._id), `${employee.firstName} ${employee.lastName}`]));
  const projectName = new Map(projects.map((project) => [String(project._id), project.name]));
  const fromPlans = plans.map((plan) => ({
    id: String(plan._id),
    kind: plan.kind,
    title: plan.title,
    dateKey: plan.dateKey,
    startTime: plan.startTime,
    endTime: plan.endTime,
    assigneeEmployeeId: String(plan.assigneeEmployeeId),
    assigneeName: person.get(String(plan.assigneeEmployeeId)) ?? "Staff",
    projectName: plan.projectId ? projectName.get(String(plan.projectId)) ?? "" : "",
    location: plan.location,
    notes: plan.notes,
    status: plan.status,
    shootId: plan.shootId ? String(plan.shootId) : undefined,
    source: "plan" as const,
  }));
  const fromShoots = shoots.filter((shoot) => !linked.has(String(shoot._id))).map((shoot) => ({
    id: String(shoot._id),
    kind: "shoot" as const,
    title: shoot.location ? `${shoot.shootCode} · ${shoot.location}` : shoot.shootCode,
    dateKey: shoot.scheduledDate,
    startTime: shoot.plannedStart || "10:00",
    endTime: shoot.plannedEnd || "18:00",
    assigneeEmployeeId: String(shoot.cinematographerId),
    assigneeName: person.get(String(shoot.cinematographerId)) ?? "Staff",
    projectName: projectName.get(String(shoot.projectId)) ?? "",
    location: shoot.location || "",
    notes: shoot.brief || "",
    status: shoot.status,
    shootId: String(shoot._id),
    source: "shoot" as const,
  }));
  return [...fromPlans, ...fromShoots].sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.startTime.localeCompare(b.startTime));
}

export async function createPlan(auth: AuthContext, input: {
  kind: (typeof KINDS)[number];
  title: string;
  dateKey: string;
  startTime?: string;
  endTime?: string;
  assigneeEmployeeId: string;
  projectId?: string;
  location?: string;
  notes?: string;
}) {
  if (!KINDS.includes(input.kind)) throw new AppError(400, "VALIDATION", "Choose a plan type.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateKey)) throw new AppError(400, "VALIDATION", "Choose a date.");
  const projectId = input.projectId?.trim() || undefined;
  const assignee = await Employee.findOne({ _id: input.assigneeEmployeeId, employmentStatus: "active" });
  if (!assignee) throw new AppError(400, "VALIDATION", "Choose an active staff member.");
  if (input.kind === "editing") await assertAssignable(input.assigneeEmployeeId, "editing.claim");
  if (input.kind === "publishing") await assertAssignable(input.assigneeEmployeeId, "publishing.publish");
  let shootId: string | undefined;
  let clientId: string | undefined;
  if (input.kind === "shoot") {
    if (!projectId) throw new AppError(400, "VALIDATION", "A shoot plan needs a project.");
    const project = await Project.findById(projectId);
    if (!project) throw new AppError(400, "VALIDATION", "Project not found.");
    const shoot = await createShoot(auth, {
      clientId: String(project.clientId),
      projectId,
      scheduledDate: input.dateKey,
      plannedStart: input.startTime || "10:00",
      plannedEnd: input.endTime || "18:00",
      location: input.location ?? "",
      cinematographerId: input.assigneeEmployeeId,
      brief: input.notes || input.title,
      plannedOutputCount: 1,
    });
    shootId = String(shoot._id);
    clientId = String(project.clientId);
  } else if (projectId) {
    const project = await Project.findById(projectId);
    if (!project) throw new AppError(400, "VALIDATION", "Project not found.");
    clientId = String(project.clientId);
  }
  const plan = await Plan.create({
    planCode: await nextCode("plan", "GY-P"),
    kind: input.kind,
    title: input.title.trim(),
    dateKey: input.dateKey,
    startTime: input.startTime || "10:00",
    endTime: input.endTime || "18:00",
    assigneeEmployeeId: assignee._id,
    clientId,
    projectId: projectId || undefined,
    shootId,
    location: input.location ?? "",
    notes: input.notes ?? "",
    createdBy: auth.userId,
  });
  if (input.kind !== "shoot" && assignee.userId) {
    await notify([String(assignee.userId)], {
      type: "plan.assigned",
      title: "Plan assigned",
      body: `${input.title.trim()} · ${input.dateKey}`,
      entityType: "plan",
      entityId: String(plan._id),
    });
  }
  await audit({ actorId: auth.userId, action: "plan.assigned", entityType: "plan", entityId: String(plan._id), after: { kind: plan.kind, dateKey: plan.dateKey, assigneeEmployeeId: String(assignee._id) } });
  return plan.toObject();
}

export async function cancelPlan(auth: AuthContext, id: string) {
  const plan = await Plan.findById(id);
  if (!plan) throw new AppError(404, "NOT_FOUND", "Plan not found.");
  if (plan.status === "cancelled") return plan.toObject();
  plan.status = "cancelled";
  await plan.save();
  if (plan.shootId) {
    await Shoot.updateOne({ _id: plan.shootId, status: "scheduled" }, { status: "cancelled" });
  }
  await audit({ actorId: auth.userId, action: "plan.cancelled", entityType: "plan", entityId: id, after: { status: "cancelled" } });
  return plan.toObject();
}

export async function cancelScheduledShoot(auth: AuthContext, id: string) {
  const shoot = await Shoot.findById(id);
  if (!shoot) throw new AppError(404, "NOT_FOUND", "Shoot not found.");
  assertClientAccess(auth, shoot.clientId, shoot.projectId);
  if (shoot.status === "cancelled") return shoot.toObject();
  shoot.status = "cancelled";
  await shoot.save();
  await Plan.updateMany({ shootId: shoot._id, status: { $ne: "cancelled" } }, { $set: { status: "cancelled" } });
  await audit({ actorId: auth.userId, action: "shoot.cancelled", entityType: "shoot", entityId: id, after: { status: "cancelled" } });
  return shoot.toObject();
}

export async function upcomingPlans(auth: AuthContext) {
  if (!auth.employeeId) return [];
  const today = businessDateKey(new Date(), await studioTimezone());
  const rows = await listPlans(auth, { from: today, mine: "1" });
  return rows.filter((row) => row.assigneeEmployeeId === auth.employeeId).slice(0, 12);
}
