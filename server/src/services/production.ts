import { assertClientAccess, scopeFilter, type AuthContext } from "../auth";
import { withTransaction } from "../db";
import { AppError, escapeRegex, pageParams } from "../http";
import { Client, Deliverable, EditingTask, Expense, Project, PublishingTask, Reshoot, Review, Shoot, TaskHistory, User } from "../models";
import { allowedProjectTransitions, type ProjectStatus } from "../domain/workflow";
import { activity, audit, nextCode, notify, recipientIds, userIdsForSystemKey } from "../platform";
import { draftInvoiceForPublished } from "./finance";
import { assertAssignable } from "./people";

type Ref = { label?: string; url?: string };

function sessionOpts(session: unknown) {
  return session ? { session } : {};
}

async function names(ids: Array<unknown>) {
  const users = await User.find({ _id: { $in: ids.filter(Boolean) } }).select("name").lean() as any;
  return new Map(users.map((user) => [String(user._id), user.name]));
}

export async function listShoots(auth: AuthContext, query: Record<string, unknown>) {
  const { page, limit, skip } = pageParams(query);
  const filter: Record<string, unknown> = { ...scopeFilter(auth) };
  if (query.status) filter.status = query.status;
  if (query.projectId) filter.projectId = query.projectId;
  if (query.clientId) filter.clientId = query.clientId;
  if (query.mine === "1" && auth.employeeId) filter.cinematographerId = auth.employeeId;
  if (query.from || query.to) {
    filter.scheduledDate = {};
    if (typeof query.from === "string") (filter.scheduledDate as Record<string, string>).$gte = query.from;
    if (typeof query.to === "string") (filter.scheduledDate as Record<string, string>).$lte = query.to;
  }
  const [rows, total] = await Promise.all([
    Shoot.find(filter).sort({ scheduledDate: 1 }).skip(skip).limit(limit).lean() as any,
    Shoot.countDocuments(filter),
  ]);
  const [clients, projects, expenses] = await Promise.all([
    Client.find({ _id: { $in: rows.map((row) => row.clientId) } }).select("name").lean() as any,
    Project.find({ _id: { $in: rows.map((row) => row.projectId) } }).select("name").lean() as any,
    Expense.find({ shootId: { $in: rows.map((row) => row._id) } }).select("shootId category description amountPaise status").lean() as any,
  ]);
  const clientName = new Map(clients.map((item) => [String(item._id), item.name]));
  const projectName = new Map(projects.map((item) => [String(item._id), item.name]));
  const expensesByShoot = new Map<string, any[]>();
  for (const expense of expenses) {
    const key = String(expense.shootId);
    expensesByShoot.set(key, [...(expensesByShoot.get(key) ?? []), expense]);
  }
  return {
    rows: rows.map((row) => ({
      ...row,
      clientName: clientName.get(String(row.clientId)) ?? "",
      projectName: projectName.get(String(row.projectId)) ?? "",
      expenses: expensesByShoot.get(String(row._id)) ?? [],
    })),
    meta: { page, limit, total },
  };
}

async function advanceProject(projectId: unknown, to: ProjectStatus) {
  const project = await Project.findById(projectId);
  if (!project) return;
  const from = project.status as ProjectStatus;
  if (from === to || !allowedProjectTransitions(from)?.includes(to)) return;
  project.status = to;
  await project.save();
}

export async function createShoot(auth: AuthContext, input: Record<string, unknown>) {
  const project = await Project.findById(input.projectId);
  if (!project) throw new AppError(400, "VALIDATION", "Project not found.");
  if (String(project.clientId) !== String(input.clientId)) throw new AppError(400, "VALIDATION", "The project does not belong to that client.");
  assertClientAccess(auth, project.clientId, project._id);
  await assertAssignable(String(input.cinematographerId), "shoots.log");
  const shoot = await Shoot.create({ ...input, shootCode: await nextCode("shoot", "GY-S"), priority: input.priority ?? project.priority });
  const cinematographer = await User.findOne({ employeeId: shoot.cinematographerId }).lean() as any;
  await notify([cinematographer ? String(cinematographer._id) : undefined], {
    type: "shoot.assigned",
    title: "Shoot assigned",
    body: `${shoot.shootCode} · ${project.name} on ${shoot.scheduledDate}`,
    entityType: "shoot",
    entityId: String(shoot._id),
  });
  await activity({ clientId: shoot.clientId, projectId: shoot.projectId, actorId: auth.userId, verb: "shoot.scheduled", summary: `Shoot ${shoot.shootCode} scheduled for ${shoot.scheduledDate}.` });
  return shoot.toObject();
}

export async function getShoot(auth: AuthContext, id: string) {
  const shoot = await Shoot.findById(id).lean() as any;
  if (!shoot) throw new AppError(404, "NOT_FOUND", "Shoot not found.");
  assertClientAccess(auth, shoot.clientId, shoot.projectId);
  const deliverables = await Deliverable.find({ shootId: id }).lean() as any;
  return { shoot, deliverables };
}

export async function startShoot(auth: AuthContext, id: string) {
  const shoot = await Shoot.findById(id);
  if (!shoot) throw new AppError(404, "NOT_FOUND", "Shoot not found.");
  assertClientAccess(auth, shoot.clientId, shoot.projectId);
  const assigned = auth.employeeId && String(shoot.cinematographerId) === auth.employeeId;
  if (!assigned && !auth.permissions.includes("shoots.edit") && !auth.isSuperAdmin) {
    throw new AppError(403, "FORBIDDEN", "Only the assigned cinematographer can start this shoot.");
  }
  if (shoot.status !== "scheduled") throw new AppError(409, "CONFLICT", "Only a scheduled shoot can be started.");
  shoot.status = "in_progress";
  shoot.actualStart = new Date();
  await shoot.save();
  await advanceProject(shoot.projectId, "in_production");
  await activity({ clientId: shoot.clientId, projectId: shoot.projectId, actorId: auth.userId, verb: "shoot.started", summary: `${shoot.shootCode} started.` });
  return shoot.toObject();
}

export async function logShootProgress(auth: AuthContext, id: string, input: { note: string; location?: string }) {
  const shoot = await Shoot.findById(id);
  if (!shoot) throw new AppError(404, "NOT_FOUND", "Shoot not found.");
  assertClientAccess(auth, shoot.clientId, shoot.projectId);
  const assigned = auth.employeeId && String(shoot.cinematographerId) === auth.employeeId;
  if (!assigned && !auth.isSuperAdmin && !auth.permissions.includes("shoots.edit")) {
    throw new AppError(403, "FORBIDDEN", "Only the assigned cinematographer can update this shoot.");
  }
  if (!["scheduled", "in_progress"].includes(shoot.status)) throw new AppError(409, "CONFLICT", "This shoot is already handed to editing.");
  if (shoot.status === "scheduled") {
    shoot.status = "in_progress";
    shoot.actualStart = shoot.actualStart ?? new Date();
    await advanceProject(shoot.projectId, "in_production");
  }
  if (input.location?.trim()) shoot.location = input.location.trim();
  shoot.progressLog.push({ at: new Date(), note: input.note.trim(), location: shoot.location });
  await shoot.save();
  await activity({ clientId: shoot.clientId, projectId: shoot.projectId, actorId: auth.userId, verb: "shoot.progress", summary: `${shoot.shootCode}: ${input.note.trim()}` });
  return shoot.toObject();
}

export async function saveFieldReport(auth: AuthContext, id: string, input: { location: string; hoursSpent: number; report: string; expenses?: Array<{ category: string; description: string; amountPaise: number }> }) {
  const shoot = await Shoot.findById(id);
  if (!shoot) throw new AppError(404, "NOT_FOUND", "Shoot not found.");
  assertClientAccess(auth, shoot.clientId, shoot.projectId);
  const assigned = auth.employeeId && String(shoot.cinematographerId) === auth.employeeId;
  if (!assigned && !auth.isSuperAdmin && !auth.permissions.includes("shoots.edit")) {
    throw new AppError(403, "FORBIDDEN", "Only the assigned cinematographer can file this report.");
  }
  if (!["scheduled", "in_progress"].includes(shoot.status)) throw new AppError(409, "CONFLICT", "This shoot is already handed to editing.");
  if (shoot.status === "scheduled") {
    shoot.status = "in_progress";
    shoot.actualStart = shoot.actualStart ?? new Date();
    await advanceProject(shoot.projectId, "in_production");
  }
  shoot.location = input.location.trim();
  shoot.hoursSpent = input.hoursSpent;
  shoot.report = input.report.trim();
  shoot.notes = shoot.report;
  shoot.progressLog.push({ at: new Date(), note: `${input.hoursSpent}h on site. ${shoot.report}`, location: shoot.location });
  await shoot.save();
  const logged: any[] = [];
  for (const item of input.expenses ?? []) {
    logged.push(await Expense.create({
      dateKey: shoot.scheduledDate,
      category: item.category,
      description: item.description.trim(),
      amountPaise: item.amountPaise,
      projectId: shoot.projectId,
      clientId: shoot.clientId,
      shootId: shoot._id,
      submittedBy: auth.userId,
      status: "pending",
      settlement: "unpaid",
      notes: `Filed with ${shoot.shootCode}.`,
    }));
  }
  if (logged.length) {
    await notify(await userIdsForSystemKey("admin"), {
      type: "expense.submitted",
      title: "Shoot expenses to approve",
      body: `${logged.length} from ${shoot.shootCode} at ${shoot.location}.`,
      entityType: "shoot",
      entityId: id,
    });
  }
  await activity({ clientId: shoot.clientId, projectId: shoot.projectId, actorId: auth.userId, verb: "shoot.reported", summary: `${shoot.shootCode}: ${shoot.hoursSpent}h at ${shoot.location}. ${logged.length} expense${logged.length === 1 ? "" : "s"} filed.` });
  return { shoot: shoot.toObject(), expenses: logged.map((item) => item.toObject()) };
}

export async function submitShoot(auth: AuthContext, id: string, input: { usableFootageCount: number; notes?: string; blockers?: string; sourceReferences?: Ref[]; outputs?: Array<Record<string, unknown>> }) {
  const existing = await Shoot.findById(id);
  if (!existing) throw new AppError(404, "NOT_FOUND", "Shoot not found.");
  assertClientAccess(auth, existing.clientId, existing.projectId);
  const assigned = auth.employeeId && String(existing.cinematographerId) === auth.employeeId;
  if (!assigned && !auth.isSuperAdmin && !auth.permissions.includes("shoots.edit")) {
    throw new AppError(403, "FORBIDDEN", "Only the assigned cinematographer can submit this shoot.");
  }
  if (existing.outputsRegistered) throw new AppError(409, "CONFLICT", "Outputs were already registered for this shoot.");
  if (!["scheduled", "in_progress"].includes(existing.status)) throw new AppError(409, "CONFLICT", "This shoot can no longer be submitted.");

  const result = await withTransaction(async (session) => {
    const shoot = await Shoot.findOneAndUpdate(
      { _id: id, outputsRegistered: false, status: { $in: ["scheduled", "in_progress"] } },
      {
        $set: {
          outputsRegistered: true,
          status: "submitted",
          actualEnd: new Date(),
          actualStart: existing.actualStart ?? new Date(),
          usableFootageCount: input.usableFootageCount,
          notes: input.notes ?? existing.notes,
          blockers: input.blockers ?? "",
          sourceReferences: input.sourceReferences ?? existing.sourceReferences,
        },
      },
      { new: true, ...sessionOpts(session) },
    );
    if (!shoot) throw new AppError(409, "CONFLICT", "Outputs were already registered for this shoot.");

    if (shoot.reshootRequestId) {
      const reshoot = await Reshoot.findById(shoot.reshootRequestId).session(session);
      if (!reshoot) throw new AppError(409, "CONFLICT", "The linked reshoot could not be found.");
      await Deliverable.updateOne(
        { _id: reshoot.deliverableId },
        { $push: { sourceReferences: { $each: input.sourceReferences ?? [] } } },
        sessionOpts(session),
      );
      const task = await EditingTask.findOne({ deliverableId: reshoot.deliverableId }).session(session);
      if (task && ["rework", "on_hold", "available", "approved", "submitted"].includes(task.status)) {
        task.status = "available";
        task.claimedBy = undefined;
        task.holdReason = undefined;
        task.lockVersion += 1;
        await task.save(sessionOpts(session));
        await Deliverable.updateOne({ _id: reshoot.deliverableId }, { status: "available", assignedEditorId: null }, sessionOpts(session));
      }
      reshoot.attemptNumber += 1;
      await reshoot.save(sessionOpts(session));
      return { shoot: shoot.toObject(), deliverables: [], reshootDeliverableId: String(reshoot.deliverableId) };
    }

    const outputs = input.outputs ?? [];
    if (!outputs.length) throw new AppError(400, "VALIDATION", "Register at least one output, or link this shoot as a reshoot.");
    const deliverables: any[] = [];
    for (const output of outputs) {
      const deliverableCode = await nextCode("deliverable", "GY-D", session);
      const created = await Deliverable.create([{
        deliverableCode,
        clientId: shoot.clientId,
        projectId: shoot.projectId,
        shootId: shoot._id,
        title: output.title,
        type: output.type ?? "promotional_video",
        platform: output.platform ?? "",
        brief: output.brief ?? shoot.brief,
        aspectRatio: output.aspectRatio ?? "",
        deadline: output.deadline,
        status: "available",
        priority: output.priority ?? shoot.priority,
        sourceReferences: output.sourceReferences ?? input.sourceReferences ?? [],
      }], sessionOpts(session));
      const deliverable = created[0];
      await EditingTask.create([{
        deliverableId: deliverable._id,
        clientId: shoot.clientId,
        projectId: shoot.projectId,
        shootId: shoot._id,
        status: "available",
        priority: deliverable.priority,
      }], sessionOpts(session));
      deliverables.push(deliverable.toObject());
    }
    return { shoot: shoot.toObject(), deliverables };
  });

  const editors = await recipientIds("editing.claim", String(existing.clientId));
  if (!existing.reshootRequestId) {
    await notify(editors, { type: "editing.available", title: "Editing tasks are available", body: `${result.deliverables.length} output${result.deliverables.length === 1 ? "" : "s"} from ${existing.shootCode}.`, entityType: "shoot", entityId: id });
  }
  if (!existing.reshootRequestId) await advanceProject(existing.projectId, "in_post");
  await activity({
    clientId: existing.clientId,
    projectId: existing.projectId,
    actorId: auth.userId,
    verb: "shoot.submitted",
    summary: existing.reshootRequestId ? `${existing.shootCode} reshoot footage was attached to the original deliverable.` : `${existing.shootCode} registered ${result.deliverables.length} deliverable${result.deliverables.length === 1 ? "" : "s"} and moved to editing.`,
  });
  return result;
}

export async function listDeliverables(auth: AuthContext, query: Record<string, unknown>) {
  const { page, limit, skip } = pageParams(query);
  const filter: Record<string, unknown> = { ...scopeFilter(auth) };
  if (query.status) filter.status = query.status;
  if (query.billableStatus) filter.billableStatus = query.billableStatus;
  if (query.projectId) filter.projectId = query.projectId;
  if (query.clientId) filter.clientId = query.clientId;
  if (typeof query.q === "string" && query.q.trim()) {
    const q = escapeRegex(query.q.trim());
    filter.$or = [{ title: { $regex: q, $options: "i" } }, { deliverableCode: { $regex: q, $options: "i" } }];
  }
  const [rows, total] = await Promise.all([
    Deliverable.find(filter).sort({ deadline: 1, createdAt: -1 }).skip(skip).limit(limit).lean() as any,
    Deliverable.countDocuments(filter),
  ]);
  return { rows, meta: { page, limit, total } };
}

export async function getDeliverable(auth: AuthContext, id: string) {
  const deliverable = await Deliverable.findById(id).lean() as any;
  if (!deliverable) throw new AppError(404, "NOT_FOUND", "Deliverable not found.");
  assertClientAccess(auth, deliverable.clientId, deliverable.projectId);
  const [task, history, reviews, reshoots, publishing, timeline, project] = await Promise.all([
    EditingTask.findOne({ deliverableId: id }).lean() as any,
    TaskHistory.find({ deliverableId: id }).sort({ createdAt: 1 }).lean() as any,
    Review.find({ deliverableId: id }).sort({ createdAt: 1 }).lean() as any,
    Reshoot.find({ deliverableId: id }).sort({ createdAt: 1 }).lean() as any,
    PublishingTask.findOne({ deliverableId: id }).lean() as any,
    (await import("../models")).Activity.find({ deliverableId: id }).sort({ createdAt: 1 }).lean() as any,
    Project.findById(deliverable.projectId).lean() as any,
  ]);
  const people = await names([task?.claimedBy, deliverable.assignedEditorId, publishing?.assignedTo, ...history.map((item) => item.actorId)]);
  return { deliverable, task, history, reviews, reshoots, publishing, timeline, project, people: Object.fromEntries(people) };
}

async function mutateTask(filter: Record<string, unknown>, update: Record<string, unknown>) {
  const task = await EditingTask.findOneAndUpdate(filter, { ...update, $inc: { lockVersion: 1 } }, { new: true });
  if (!task) throw new AppError(409, "CONFLICT", "The task changed before this action could be saved. Refresh and try again.");
  return task;
}

export async function listQueue(auth: AuthContext, query: Record<string, unknown>) {
  const filter: Record<string, unknown> = { ...scopeFilter(auth) };
  if (typeof query.status === "string" && query.status) filter.status = query.status;
  if (query.mine === "1") filter.claimedBy = auth.userId;
  const tasks = await EditingTask.find(filter).sort({ priority: -1, createdAt: 1 }).lean() as any;
  const deliverables = await Deliverable.find({ _id: { $in: tasks.map((task) => task.deliverableId) } }).lean() as any;
  const byId = new Map<string, any>(deliverables.map((item: any) => [String(item._id), item]));
  const clients = await Client.find({ _id: { $in: deliverables.map((item) => item.clientId) } }).select("name").lean() as any;
  const projects = await Project.find({ _id: { $in: deliverables.map((item) => item.projectId) } }).select("name").lean() as any;
  const clientName = new Map(clients.map((item) => [String(item._id), item.name]));
  const projectName = new Map(projects.map((item) => [String(item._id), item.name]));
  const people = await names(tasks.map((task) => task.claimedBy));
  const now = Date.now();
  return tasks.map((task) => {
    const deliverable = byId.get(String(task.deliverableId));
    const started = task.startedAt ?? task.claimedAt;
    const end = task.completedAt?.getTime() ?? now;
    return {
      ...task,
      id: task._id,
      deliverable,
      clientName: deliverable ? clientName.get(String(deliverable.clientId)) : "",
      projectName: deliverable ? projectName.get(String(deliverable.projectId)) : "",
      hoursSpent: task.hoursSpent ?? 0,
      outcome: task.outcome ?? "",
      ownerName: task.claimedBy ? people.get(String(task.claimedBy)) : null,
      elapsedMinutes: started ? Math.round((end - new Date(started).getTime()) / 60000) : null,
      overdue: Boolean(deliverable?.deadline && deliverable.deadline < new Date().toISOString().slice(0, 10) && !["approved"].includes(task.status)),
    };
  });
}

export async function claimTask(auth: AuthContext, taskId: string) {
  const current = await EditingTask.findById(taskId);
  if (!current) throw new AppError(404, "NOT_FOUND", "Task not found.");
  assertClientAccess(auth, current.clientId, current.projectId);
  const task = await EditingTask.findOneAndUpdate(
    { _id: taskId, status: "available", claimedBy: null },
    { $set: { status: "claimed", claimedBy: auth.userId, claimedAt: new Date() }, $inc: { lockVersion: 1 } },
    { new: true },
  );
  if (!task) throw new AppError(409, "CONFLICT", "This task was just claimed by someone else.");
  await Deliverable.updateOne({ _id: task.deliverableId }, { status: "claimed", assignedEditorId: auth.userId });
  await TaskHistory.create({ taskId, deliverableId: task.deliverableId, action: "claimed", toUserId: auth.userId, actorId: auth.userId });
  await notify(await recipientIds("editing.reassign", String(task.clientId)), { type: "editing.claimed", title: "Task claimed", body: `${auth.name} claimed a deliverable.`, entityType: "deliverable", entityId: String(task.deliverableId) });
  return task.toObject();
}

export async function startTask(auth: AuthContext, taskId: string) {
  const task = await mutateTask({ _id: taskId, status: "claimed", claimedBy: auth.userId }, { $set: { status: "in_progress", startedAt: new Date() } });
  await Deliverable.updateOne({ _id: task.deliverableId }, { status: "in_progress" });
  await TaskHistory.create({ taskId, deliverableId: task.deliverableId, action: "started", actorId: auth.userId, toUserId: auth.userId });
  return task.toObject();
}

export async function logTaskProgress(auth: AuthContext, taskId: string, input: { hoursSpent: number; outcome: string }) {
  const task = await EditingTask.findOne({ _id: taskId, claimedBy: auth.userId, status: { $in: ["claimed", "in_progress"] } });
  if (!task) throw new AppError(409, "CONFLICT", "Only the editor who holds this cut can log progress.");
  task.hoursSpent = input.hoursSpent;
  task.outcome = input.outcome.trim();
  task.workNotes = task.outcome;
  if (task.status === "claimed") {
    task.status = "in_progress";
    task.startedAt = task.startedAt ?? new Date();
    await Deliverable.updateOne({ _id: task.deliverableId }, { status: "in_progress" });
  }
  task.lockVersion += 1;
  await task.save();
  await activity({ clientId: task.clientId, projectId: task.projectId, deliverableId: task.deliverableId, actorId: auth.userId, verb: "editing.progress", summary: `${input.hoursSpent}h logged. ${task.outcome}` });
  return task.toObject();
}

export async function holdTask(auth: AuthContext, taskId: string, reason: string) {
  if (!reason.trim()) throw new AppError(400, "VALIDATION", "A hold needs a reason.");
  const task = await mutateTask({ _id: taskId, claimedBy: auth.userId, status: { $in: ["claimed", "in_progress"] } }, { $set: { status: "on_hold", holdReason: reason.trim() } });
  await Deliverable.updateOne({ _id: task.deliverableId }, { status: "on_hold" });
  await TaskHistory.create({ taskId, deliverableId: task.deliverableId, action: "held", actorId: auth.userId, reason });
  await activity({ clientId: task.clientId, projectId: task.projectId, deliverableId: task.deliverableId, actorId: auth.userId, verb: "editing.hold", summary: `Editing paused: ${reason.trim()}` });
  return task.toObject();
}

export async function resumeTask(auth: AuthContext, taskId: string) {
  const task = await mutateTask({ _id: taskId, claimedBy: auth.userId, status: { $in: ["on_hold", "rework"] } }, { $set: { status: "in_progress", holdReason: null, startedAt: new Date() } });
  await Deliverable.updateOne({ _id: task.deliverableId }, { status: "in_progress" });
  await TaskHistory.create({ taskId, deliverableId: task.deliverableId, action: "resumed", actorId: auth.userId });
  return task.toObject();
}

export async function releaseTask(auth: AuthContext, taskId: string) {
  const task = await mutateTask({ _id: taskId, claimedBy: auth.userId, status: { $in: ["claimed", "in_progress", "on_hold"] } }, { $set: { status: "available", claimedBy: null, holdReason: null } });
  await Deliverable.updateOne({ _id: task.deliverableId }, { status: "available", assignedEditorId: null });
  await TaskHistory.create({ taskId, deliverableId: task.deliverableId, action: "released", fromUserId: auth.userId, actorId: auth.userId });
  return task.toObject();
}

export async function submitTask(auth: AuthContext, taskId: string, input: { notes?: string; hoursSpent?: number; exportReferences?: Ref[] }) {
  const refs = (input.exportReferences ?? []).filter((item) => item.url);
  const task = await mutateTask(
    { _id: taskId, claimedBy: auth.userId, status: "in_progress" },
    { $set: { status: "submitted", submittedAt: new Date(), ...(input.notes?.trim() ? { workNotes: input.notes.trim(), outcome: input.notes.trim() } : {}), ...(input.hoursSpent ? { hoursSpent: input.hoursSpent } : {}) } },
  );
  await Deliverable.updateOne({ _id: task.deliverableId }, { status: "submitted", ...(refs.length ? { exportReferences: refs } : {}) });
  await TaskHistory.create({ taskId, deliverableId: task.deliverableId, action: "submitted", actorId: auth.userId });
  await notify(await recipientIds("editing.review", String(task.clientId)), { type: "editing.review", title: "Edit ready for review", body: "An editor submitted an output.", entityType: "deliverable", entityId: String(task.deliverableId) });
  await activity({ clientId: task.clientId, projectId: task.projectId, deliverableId: task.deliverableId, actorId: auth.userId, verb: "editing.submitted", summary: "Edit submitted for internal review." });
  return task.toObject();
}

export async function reassignTask(auth: AuthContext, taskId: string, toUserId: string, reason: string) {
  if (!reason.trim()) throw new AppError(400, "VALIDATION", "Reassignment requires a reason.");
  await assertAssignable(toUserId, "editing.claim", "user");
  const assignee = await User.findOne({ _id: toUserId, status: "active" });
  if (!assignee) throw new AppError(400, "VALIDATION", "Choose an active user.");
  const current = await EditingTask.findById(taskId);
  if (!current) throw new AppError(404, "NOT_FOUND", "Task not found.");
  assertClientAccess(auth, current.clientId, current.projectId);
  if (!["claimed", "in_progress", "on_hold", "rework"].includes(current.status)) {
    throw new AppError(409, "CONFLICT", "This task cannot be reassigned from its current state.");
  }
  const previous = current.claimedBy ? String(current.claimedBy) : undefined;
  const task = await EditingTask.findOneAndUpdate(
    { _id: taskId, lockVersion: current.lockVersion, status: current.status },
    { $set: { claimedBy: toUserId, status: "claimed", claimedAt: new Date(), holdReason: null }, $inc: { lockVersion: 1 } },
    { new: true },
  );
  if (!task) throw new AppError(409, "CONFLICT", "The task changed before it could be reassigned.");
  await Deliverable.updateOne({ _id: task.deliverableId }, { status: "claimed", assignedEditorId: toUserId });
  await TaskHistory.create({ taskId, deliverableId: task.deliverableId, action: "reassigned", fromUserId: previous, toUserId, actorId: auth.userId, reason: reason.trim() });
  await notify([previous, toUserId], { type: "editing.reassigned", title: "Editing task reassigned", body: reason.trim(), entityType: "deliverable", entityId: String(task.deliverableId) });
  await audit({ actorId: auth.userId, action: "editing.reassigned", entityType: "editing_task", entityId: taskId, before: { claimedBy: previous }, after: { claimedBy: toUserId, reason } });
  return task.toObject();
}

async function ensurePublishing(deliverableId: string, session?: unknown) {
  const deliverable = await Deliverable.findById(deliverableId).session(session ?? null);
  if (!deliverable) return;
  const existing = await PublishingTask.findOne({ deliverableId }).session(session ?? null);
  if (existing) return existing;
  const created = await PublishingTask.create([{
    deliverableId,
    clientId: deliverable.clientId,
    projectId: deliverable.projectId,
    platform: deliverable.platform || "unspecified",
    status: "ready",
  }], sessionOpts(session ?? null));
  return created[0];
}

export async function reviewDeliverable(auth: AuthContext, deliverableId: string, input: { decision: "approved" | "rework"; feedback?: string }) {
  const deliverable = await Deliverable.findById(deliverableId);
  if (!deliverable) throw new AppError(404, "NOT_FOUND", "Deliverable not found.");
  assertClientAccess(auth, deliverable.clientId, deliverable.projectId);
  const task = await EditingTask.findOne({ deliverableId, status: "submitted" });
  if (!task) throw new AppError(409, "CONFLICT", "Only a submitted edit can be reviewed.");
  if (input.decision === "rework" && !input.feedback?.trim()) throw new AppError(400, "VALIDATION", "Rework needs reviewer feedback.");
  const project = await Project.findById(deliverable.projectId);
  const revisionNumber = deliverable.revisionCount + (input.decision === "rework" ? 1 : 0);
  await Review.create({
    deliverableId,
    reviewerId: auth.userId,
    decision: input.decision,
    feedback: input.feedback ?? "",
    revisionNumber: input.decision === "rework" ? revisionNumber : deliverable.revisionCount,
    exportReference: deliverable.exportReferences?.[0],
    kind: "internal",
  });
  if (input.decision === "approved") {
    const needsClient = Boolean(project?.requiresClientApproval);
    deliverable.approvalStatus = "internal_approved";
    deliverable.status = needsClient ? "approved" : "ready_to_publish";
    task.status = "approved";
    task.completedAt = new Date();
    await task.save();
    await deliverable.save();
    if (!needsClient) {
      await ensurePublishing(deliverableId);
      await advanceProject(deliverable.projectId, "ready_for_publishing");
    } else {
      await advanceProject(deliverable.projectId, "awaiting_approval");
    }
    await notify([task.claimedBy ? String(task.claimedBy) : undefined], { type: "editing.approved", title: "Edit approved", body: deliverable.title, entityType: "deliverable", entityId: deliverableId });
  } else {
    deliverable.revisionCount += 1;
    deliverable.approvalStatus = "rejected";
    deliverable.status = "rework";
    task.status = "rework";
    await task.save();
    await deliverable.save();
    await notify([task.claimedBy ? String(task.claimedBy) : undefined], { type: "editing.rework", title: "Rework requested", body: input.feedback ?? "", entityType: "deliverable", entityId: deliverableId });
  }
  await TaskHistory.create({ taskId: task._id, deliverableId, action: input.decision, actorId: auth.userId, reason: input.feedback });
  await activity({ clientId: deliverable.clientId, projectId: deliverable.projectId, deliverableId, actorId: auth.userId, verb: `review.${input.decision}`, summary: input.decision === "approved" ? "Internal review approved this deliverable." : `Rework requested. Revision ${deliverable.revisionCount}.` });
  return getDeliverable(auth, deliverableId);
}

export async function clientApprove(auth: AuthContext, deliverableId: string, feedback?: string) {
  const deliverable = await Deliverable.findById(deliverableId);
  if (!deliverable) throw new AppError(404, "NOT_FOUND", "Deliverable not found.");
  assertClientAccess(auth, deliverable.clientId, deliverable.projectId);
  const project = await Project.findById(deliverable.projectId);
  if (!project?.requiresClientApproval) throw new AppError(409, "CONFLICT", "This project does not require a separate client approval.");
  if (deliverable.approvalStatus !== "internal_approved") throw new AppError(409, "CONFLICT", "Internal approval is required first.");
  deliverable.approvalStatus = "client_approved";
  deliverable.status = "ready_to_publish";
  await deliverable.save();
  await Review.create({ deliverableId, reviewerId: auth.userId, decision: "approved", feedback: feedback ?? "Client approval recorded.", revisionNumber: deliverable.revisionCount, kind: "client" });
  await ensurePublishing(deliverableId);
  await advanceProject(deliverable.projectId, "ready_for_publishing");
  await activity({ clientId: deliverable.clientId, projectId: deliverable.projectId, deliverableId, actorId: auth.userId, verb: "review.client_approved", summary: "Client approval recorded. Ready to post." });
  return getDeliverable(auth, deliverableId);
}

export async function listReshoots(auth: AuthContext, query: Record<string, unknown>) {
  const filter: Record<string, unknown> = { ...scopeFilter(auth) };
  if (query.status) filter.approvalStatus = query.status;
  return Reshoot.find(filter).sort({ createdAt: -1 }).lean() as any;
}

export async function createReshoot(auth: AuthContext, input: { deliverableId: string; reason: string; notes?: string }) {
  const deliverable = await Deliverable.findById(input.deliverableId);
  if (!deliverable) throw new AppError(404, "NOT_FOUND", "Deliverable not found.");
  assertClientAccess(auth, deliverable.clientId, deliverable.projectId);
  const attemptNumber = (await Reshoot.countDocuments({ deliverableId: deliverable._id })) + 1;
  const reshoot = await Reshoot.create({
    reshootCode: await nextCode("reshoot", "GY-R"),
    deliverableId: deliverable._id,
    originalShootId: deliverable.shootId,
    clientId: deliverable.clientId,
    projectId: deliverable.projectId,
    requestedBy: auth.userId,
    reason: input.reason,
    notes: input.notes ?? "",
    attemptNumber,
  });
  await notify(await recipientIds("reshoots.approve", String(deliverable.clientId)), { type: "reshoot.requested", title: "Reshoot requested", body: `${deliverable.title} · ${input.reason}`, entityType: "reshoot", entityId: String(reshoot._id) });
  await activity({ clientId: deliverable.clientId, projectId: deliverable.projectId, deliverableId: deliverable._id, actorId: auth.userId, verb: "reshoot.requested", summary: `Reshoot requested for ${deliverable.deliverableCode}.` });
  return reshoot.toObject();
}

export async function decideReshoot(auth: AuthContext, id: string, input: { approvalStatus: "approved" | "rejected"; billableDecision?: "pending" | "approved" | "waived" | "partial"; chargePaise?: number; communicationNote?: string }) {
  const reshoot = await Reshoot.findById(id);
  if (!reshoot) throw new AppError(404, "NOT_FOUND", "Reshoot not found.");
  assertClientAccess(auth, reshoot.clientId, reshoot.projectId);
  if (reshoot.approvalStatus !== "pending") throw new AppError(409, "CONFLICT", "This reshoot has already been decided.");
  reshoot.approvalStatus = input.approvalStatus;
  if (input.approvalStatus === "approved") {
    reshoot.billableDecision = input.billableDecision ?? "pending";
    reshoot.chargePaise = reshoot.billableDecision === "waived" || reshoot.billableDecision === "pending" ? 0 : input.chargePaise ?? 0;
    if ((reshoot.billableDecision === "approved" || reshoot.billableDecision === "partial") && reshoot.chargePaise <= 0) {
      throw new AppError(400, "VALIDATION", "A billable reshoot needs a charge greater than zero, or mark it waived.");
    }
  }
  reshoot.communicationNote = input.communicationNote ?? "";
  await reshoot.save();
  await audit({ actorId: auth.userId, action: "reshoot.decided", entityType: "reshoot", entityId: id, after: { approvalStatus: reshoot.approvalStatus, billableDecision: reshoot.billableDecision, chargePaise: reshoot.chargePaise } });
  return reshoot.toObject();
}

export async function scheduleReshoot(auth: AuthContext, id: string, input: { scheduledDate: string; cinematographerId: string; location?: string; plannedStart?: string; plannedEnd?: string }) {
  await assertAssignable(input.cinematographerId, "shoots.log");
  const reshoot = await Reshoot.findById(id);
  if (!reshoot) throw new AppError(404, "NOT_FOUND", "Reshoot not found.");
  assertClientAccess(auth, reshoot.clientId, reshoot.projectId);
  if (reshoot.approvalStatus !== "approved") throw new AppError(409, "CONFLICT", "Approve the reshoot before scheduling it.");
  if (reshoot.resultingShootId) throw new AppError(409, "CONFLICT", "A shoot is already scheduled for this reshoot.");
  const shoot = await Shoot.create({
    shootCode: await nextCode("shoot", "GY-S"),
    clientId: reshoot.clientId,
    projectId: reshoot.projectId,
    scheduledDate: input.scheduledDate,
    plannedStart: input.plannedStart ?? "10:00",
    plannedEnd: input.plannedEnd ?? "18:00",
    location: input.location ?? "",
    cinematographerId: input.cinematographerId,
    brief: `Reshoot ${reshoot.reshootCode} for the original deliverable.`,
    plannedOutputCount: 0,
    reshootRequestId: reshoot._id,
    status: "scheduled",
  });
  reshoot.resultingShootId = shoot._id;
  reshoot.assignedCinematographerId = input.cinematographerId as unknown as typeof reshoot.assignedCinematographerId;
  reshoot.scheduledDate = input.scheduledDate;
  await reshoot.save();
  return { reshoot: reshoot.toObject(), shoot: shoot.toObject() };
}

export async function listPublishing(auth: AuthContext, query: Record<string, unknown>) {
  const filter: Record<string, unknown> = { ...scopeFilter(auth) };
  if (query.status) filter.status = query.status;
  if (query.mine === "1") filter.assignedTo = auth.userId;
  const tasks = await PublishingTask.find(filter).sort({ scheduledAt: 1, createdAt: -1 }).lean() as any;
  const deliverables = await Deliverable.find({ _id: { $in: tasks.map((task) => task.deliverableId) } }).lean() as any;
  const byId = new Map<string, any>(deliverables.map((item: any) => [String(item._id), item]));
  const clients = await Client.find({ _id: { $in: tasks.map((task) => task.clientId) } }).select("name").lean() as any;
  const projects = await Project.find({ _id: { $in: tasks.map((task) => task.projectId) } }).select("name projectCode").lean() as any;
  const edits = await EditingTask.find({ deliverableId: { $in: tasks.map((task) => task.deliverableId) } }).select("deliverableId outcome hoursSpent").lean() as any;
  const clientName = new Map(clients.map((item) => [String(item._id), item.name]));
  const projectName = new Map(projects.map((item) => [String(item._id), item.name]));
  const projectCode = new Map(projects.map((item) => [String(item._id), item.projectCode]));
  const editByDeliverable = new Map<string, any>(edits.map((item: any) => [String(item.deliverableId), item]));
  return tasks.map((task) => {
    const deliverable = byId.get(String(task.deliverableId));
    const edit = editByDeliverable.get(String(task.deliverableId));
    return {
      ...task,
      clientName: clientName.get(String(task.clientId)) ?? "",
      projectName: projectName.get(String(task.projectId)) ?? "",
      projectCode: projectCode.get(String(task.projectId)) ?? "",
      deliverable: deliverable ? {
        title: deliverable.title,
        deliverableCode: deliverable.deliverableCode,
        brief: deliverable.brief,
        deadline: deliverable.deadline,
        aspectRatio: deliverable.aspectRatio,
        revisionCount: deliverable.revisionCount,
        platform: deliverable.platform,
      } : undefined,
      outcome: edit?.outcome ?? "",
      hoursSpent: edit?.hoursSpent ?? 0,
    };
  });
}

export async function schedulePost(auth: AuthContext, id: string, input: { scheduledAt: string; caption?: string; notes?: string; assignedTo?: string }) {
  const task = await PublishingTask.findById(id);
  if (!task) throw new AppError(404, "NOT_FOUND", "Publishing task not found.");
  assertClientAccess(auth, task.clientId, task.projectId);
  if (task.status === "published") throw new AppError(409, "CONFLICT", "A published post cannot be scheduled again. Record a new delivery if the platform requires it.");
  task.scheduledAt = new Date(input.scheduledAt);
  task.caption = input.caption ?? task.caption;
  task.notes = input.notes ?? task.notes;
  task.assignedTo = (input.assignedTo ?? auth.userId) as unknown as typeof task.assignedTo;
  task.status = "scheduled";
  task.failureReason = undefined;
  await task.save();
  await activity({ clientId: task.clientId, projectId: task.projectId, deliverableId: task.deliverableId, actorId: auth.userId, verb: "publishing.scheduled", summary: `Post scheduled for ${task.scheduledAt.toISOString()}.` });
  return task.toObject();
}

export async function publishPost(auth: AuthContext, id: string, input: { publishedUrl: string; platform: string; aspectRatio?: string; caption?: string; proofAssetId?: string; notes?: string }) {
  let url: URL;
  try {
    url = new URL(input.publishedUrl);
  } catch {
    throw new AppError(400, "VALIDATION", "Enter the live URL of the published post.");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new AppError(400, "VALIDATION", "The published URL must start with http or https.");
  const platform = input.platform.trim();
  if (!platform || platform.toLowerCase() === "unspecified") throw new AppError(400, "VALIDATION", "Choose the platform.");
  const task = await PublishingTask.findById(id);
  if (!task) throw new AppError(404, "NOT_FOUND", "Publishing task not found.");
  assertClientAccess(auth, task.clientId, task.projectId);
  if (task.status === "published") throw new AppError(409, "CONFLICT", "This post is already recorded as published.");
  const aspectRatio = input.aspectRatio?.trim() ?? "";
  task.status = "published";
  task.platform = platform;
  task.caption = input.caption?.trim() ?? "";
  task.publishedUrl = input.publishedUrl;
  task.publishedAt = new Date();
  task.proofAssetId = input.proofAssetId as unknown as typeof task.proofAssetId;
  task.notes = input.notes?.trim() ?? task.notes;
  task.assignedTo = task.assignedTo ?? (auth.userId as unknown as typeof task.assignedTo);
  await task.save();
  const posted = { status: "published", platform, ...(aspectRatio ? { aspectRatio } : {}) };
  await Deliverable.updateOne({ _id: task.deliverableId, billableStatus: "unbilled" }, { ...posted, billableStatus: "eligible" });
  await Deliverable.updateOne({ _id: task.deliverableId, billableStatus: { $ne: "unbilled" } }, posted);
  const invoice = await draftInvoiceForPublished(auth, task);
  await activity({ clientId: task.clientId, projectId: task.projectId, deliverableId: task.deliverableId, actorId: auth.userId, verb: "publishing.published", summary: `Published on ${platform} at ${input.publishedUrl}. Draft ${invoice.invoice.invoiceNumber} is ready for the admin.` });
  return { ...task.toObject(), invoiceId: invoice.invoice._id, invoiceNumber: invoice.invoice.invoiceNumber };
}

export async function failPost(auth: AuthContext, id: string, reason: string) {
  if (!reason.trim()) throw new AppError(400, "VALIDATION", "A failed post needs a reason.");
  const task = await PublishingTask.findById(id);
  if (!task) throw new AppError(404, "NOT_FOUND", "Publishing task not found.");
  assertClientAccess(auth, task.clientId, task.projectId);
  if (task.status === "published") throw new AppError(409, "CONFLICT", "A published post cannot be marked failed.");
  task.status = "failed";
  task.failureReason = reason.trim();
  await task.save();
  await activity({ clientId: task.clientId, projectId: task.projectId, deliverableId: task.deliverableId, actorId: auth.userId, verb: "publishing.failed", summary: reason.trim() });
  return task.toObject();
}
