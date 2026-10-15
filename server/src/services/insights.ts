import { hasPermission, scopeFilter, type AuthContext } from "../auth";
import { businessDateKey, rangeFromKeys } from "../domain/dates";
import { AppError, escapeRegex } from "../http";
import { Attendance, Client, Deliverable, EditingTask, Employee, Expense, Invoice, LeaveRequest, Payment, PayrollPeriod, Payslip, Project, PublishingTask, Reshoot, Shoot } from "../models";
import { Activity } from "../models";
import { studioTimezone } from "../platform";
import { upcomingPlans } from "./plans";

function pipelineFor(auth: AuthContext, counts: { clients: number; projects: number; shoots: number; editing: number; posting: number; posted: number; invoice: number }) {
  const steps = [
    { key: "client", label: "Client", count: counts.clients, text: "Create a client, or continue with one that already exists." },
    { key: "project", label: "Project", count: counts.projects, text: "Open the job under that client." },
    { key: "shoot", label: "Camera", count: counts.shoots, text: "The cinematographer logs the client, location, time, and progress, then marks the shoot done." },
    { key: "edit", label: "Editing", count: counts.editing, text: "An editor claims the cut, logs hours, and records the outcome." },
    { key: "post", label: "Posting", count: counts.posting, text: "The social manager or an admin posts the approved outcomes." },
    { key: "invoice", label: "Invoice", count: counts.invoice, text: "Invoice the client for work that has been posted." },
  ];
  let yours = "client";
  if (hasPermission(auth, "shoots.log") && !hasPermission(auth, "editing.claim") && !hasPermission(auth, "publishing.publish") && !hasPermission(auth, "invoices.create")) yours = "shoot";
  else if (hasPermission(auth, "editing.claim") && !hasPermission(auth, "publishing.publish") && !hasPermission(auth, "invoices.create")) yours = "edit";
  else if (hasPermission(auth, "publishing.publish") && !hasPermission(auth, "invoices.create")) yours = "post";
  else if (counts.shoots) yours = "shoot";
  else if (counts.editing) yours = "edit";
  else if (counts.posting) yours = "post";
  else if (counts.invoice) yours = "invoice";
  else if (counts.projects) yours = "project";
  return { yours, posted: counts.posted, waitingToPost: counts.posting, steps };
}

export async function dashboard(auth: AuthContext, fromKey: string, toKey: string) {
  const timeZone = await studioTimezone();
  const { start, end } = rangeFromKeys(fromKey, toKey, timeZone);
  const today = businessDateKey(new Date(), timeZone);
  const scope = scopeFilter(auth);
  const financial = hasPermission(auth, "analytics.financial");
  const [invoicedAgg, collectedAgg, outstandingAgg, expenseAgg, payrollAgg, activeClients, activeProjects, deliverables, shootsToday, queue, publishing, postedCount, readyToInvoice, reshoots, attendance, activity] = await Promise.all([
    financial ? Invoice.aggregate([{ $match: { status: { $in: ["issued", "partially_paid", "paid"] }, issueDate: { $gte: start, $lte: end } } }, { $group: { _id: null, total: { $sum: "$totalPaise" } } }]) : [],
    financial ? Payment.aggregate([{ $match: { paidAt: { $gte: start, $lte: end } } }, { $group: { _id: null, total: { $sum: "$amountPaise" } } }]) : [],
    financial ? Invoice.aggregate([{ $match: { status: { $in: ["issued", "partially_paid"] } } }, { $group: { _id: null, total: { $sum: { $subtract: ["$totalPaise", "$paidPaise"] } } } }]) : [],
    financial ? Expense.aggregate([{ $match: { status: "approved", dateKey: { $gte: fromKey, $lte: toKey } } }, { $group: { _id: null, total: { $sum: "$amountPaise" } } }]) : [],
    financial ? Payslip.aggregate([{ $match: { monthKey: { $gte: fromKey.slice(0, 7), $lte: toKey.slice(0, 7) } } }, { $group: { _id: null, total: { $sum: "$netPaise" } } }]) : [],
    Client.countDocuments({ status: "active", ...(auth.scopeClientIds.length && !auth.isSuperAdmin ? { _id: { $in: auth.scopeClientIds } } : {}) }),
    Project.countDocuments({ status: { $nin: ["completed", "cancelled"] }, ...scope }),
    Deliverable.find({ ...scope }).select("status deadline title deliverableCode projectId clientId assignedEditorId").lean() as any,
    Shoot.find({ ...scope, scheduledDate: today, status: { $ne: "cancelled" } }).lean() as any,
    EditingTask.countDocuments({ ...scope, status: { $in: ["available", "claimed", "in_progress", "on_hold", "rework"] } }),
    PublishingTask.find({ ...scope, status: { $in: ["ready", "scheduled", "failed"] } }).lean() as any,
    PublishingTask.countDocuments({ ...scope, status: "published" }),
    Deliverable.countDocuments({ ...scope, billableStatus: "eligible" }),
    Reshoot.countDocuments({ ...scope, approvalStatus: "pending" }),
    hasPermission(auth, "attendance.view") ? Attendance.find({ dateKey: today }).lean() as any : [],
    Activity.find(auth.isSuperAdmin || !auth.scopeClientIds.length ? {} : { clientId: { $in: auth.scopeClientIds } }).sort({ createdAt: -1 }).limit(12).lean() as any,
  ]);
  const open = new Set(["available", "claimed", "in_progress", "on_hold", "submitted", "rework"]);
  const overdue = deliverables.filter((item) => item.deadline && item.deadline < today && open.has(item.status));
  const mine = {
    shoots: auth.employeeId ? await Shoot.find({ cinematographerId: auth.employeeId, status: { $in: ["scheduled", "in_progress"] } }).sort({ scheduledDate: 1 }).limit(8).lean() as any : [],
    tasks: await EditingTask.find({ claimedBy: auth.userId, status: { $nin: ["approved"] } }).limit(8).lean() as any,
    posts: await PublishingTask.find({ assignedTo: auth.userId, status: { $in: ["ready", "scheduled", "failed"] } }).limit(8).lean() as any,
    plans: await upcomingPlans(auth),
  };
  const headcount = hasPermission(auth, "attendance.view") ? await Employee.countDocuments({ employmentStatus: "active" }) : 0;
  const presentIds = new Set(attendance.map((item) => String(item.employeeId)));
  return {
    range: { from: fromKey, to: toKey },
    financial: financial ? {
      invoicedPaise: invoicedAgg[0]?.total ?? 0,
      collectedPaise: collectedAgg[0]?.total ?? 0,
      outstandingPaise: outstandingAgg[0]?.total ?? 0,
      expensesPaise: expenseAgg[0]?.total ?? 0,
      payrollPaise: payrollAgg[0]?.total ?? 0,
      cashContributionPaise: (collectedAgg[0]?.total ?? 0) - (expenseAgg[0]?.total ?? 0) - (payrollAgg[0]?.total ?? 0),
      label: "Cash contribution is collected payments minus approved expenses and payroll in the range. It is not statutory net profit.",
    } : undefined,
    operations: {
      activeClients,
      activeProjects,
      pendingDeliverables: deliverables.filter((item) => open.has(item.status)).length,
      overdueTasks: overdue.length,
      overdue,
      todayShoots: shootsToday,
      editingQueue: queue,
      pendingApprovals: deliverables.filter((item) => item.status === "submitted").length,
      scheduledPosts: publishing.filter((item) => item.status === "scheduled").length,
      publishingQueue: publishing,
      reshootsOpen: reshoots,
      blocked: deliverables.filter((item) => item.status === "on_hold" || item.status === "rework").length,
      invoicesToPrepare: financial || hasPermission(auth, "invoices.view") ? await Invoice.countDocuments({ status: { $in: ["draft", "pending_approval"] } }) : undefined,
      postedCount,
      readyToInvoice,
    },
    pipeline: pipelineFor(auth, {
      clients: activeClients,
      projects: activeProjects,
      shoots: auth.employeeId ? mine.shoots.length : shootsToday.filter((item) => item.status !== "submitted").length,
      editing: queue,
      posting: publishing.length,
      posted: postedCount,
      invoice: readyToInvoice,
    }),
    attendance: hasPermission(auth, "attendance.view") ? {
      presentToday: attendance.length,
      lateToday: attendance.filter((item) => item.late).length,
      absentToday: Math.max(0, headcount - presentIds.size),
      openLeave: await LeaveRequest.countDocuments({ status: "pending" }),
    } : undefined,
    mine,
    activity,
  };
}

export async function financialReport(auth: AuthContext, fromKey: string, toKey: string) {
  if (!hasPermission(auth, "analytics.financial")) throw new AppError(403, "FORBIDDEN", "Financial reports are restricted.");
  const timeZone = await studioTimezone();
  const { start, end } = rangeFromKeys(fromKey, toKey, timeZone);
  const [monthlyInvoices, monthlyPayments, categories, clients, projects, expenses, payroll] = await Promise.all([
    Invoice.aggregate([
      { $match: { status: { $in: ["issued", "partially_paid", "paid"] }, issueDate: { $gte: start, $lte: end } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$issueDate", timezone: timeZone } }, invoicedPaise: { $sum: "$totalPaise" } } },
      { $sort: { _id: 1 } },
    ]),
    Payment.aggregate([
      { $match: { paidAt: { $gte: start, $lte: end } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$paidAt", timezone: timeZone } }, collectedPaise: { $sum: "$amountPaise" } } },
    ]),
    Expense.aggregate([
      { $match: { status: "approved", dateKey: { $gte: fromKey, $lte: toKey } } },
      { $group: { _id: "$category", amountPaise: { $sum: "$amountPaise" } } },
      { $sort: { amountPaise: -1 } },
    ]),
    Invoice.aggregate([
      { $match: { status: { $in: ["issued", "partially_paid", "paid"] }, issueDate: { $gte: start, $lte: end } } },
      { $group: { _id: "$clientId", invoicedPaise: { $sum: "$totalPaise" }, collectedPaise: { $sum: "$paidPaise" } } },
    ]),
    Expense.aggregate([
      { $match: { status: "approved", projectId: { $ne: null }, dateKey: { $gte: fromKey, $lte: toKey } } },
      { $group: { _id: "$projectId", expensesPaise: { $sum: "$amountPaise" } } },
    ]),
    Expense.aggregate([{ $match: { status: "approved", dateKey: { $gte: fromKey, $lte: toKey } } }, { $group: { _id: "$settlement", amountPaise: { $sum: "$amountPaise" } } }]),
    PayrollPeriod.find({ monthKey: { $gte: fromKey.slice(0, 7), $lte: toKey.slice(0, 7) }, status: "finalized" }).lean() as any,
  ]);
  const clientDocs = await Client.find({ _id: { $in: clients.map((item) => item._id) } }).select("name").lean() as any;
  const clientName = new Map(clientDocs.map((item) => [String(item._id), item.name]));
  const collectedByMonth = new Map(monthlyPayments.map((item) => [item._id, item.collectedPaise]));
  return {
    monthly: monthlyInvoices.map((item) => ({ month: item._id, invoicedPaise: item.invoicedPaise, collectedPaise: collectedByMonth.get(item._id) ?? 0 })),
    expenseByCategory: categories.map((item) => ({ category: item._id, amountPaise: item.amountPaise })),
    expenses,
    payrollPeriods: payroll.length,
    clients: clients.map((item) => ({
      clientId: item._id,
      name: clientName.get(String(item._id)) ?? "Client",
      invoicedPaise: item.invoicedPaise,
      collectedPaise: item.collectedPaise,
      outstandingPaise: item.invoicedPaise - item.collectedPaise,
    })),
    projectExpenses: projects,
    note: "Collected cash and invoiced totals are separate. Outstanding is invoiced minus payments allocated to those invoices.",
  };
}

export async function productionReport(auth: AuthContext, fromKey: string, toKey: string) {
  if (!hasPermission(auth, "analytics.view") && !hasPermission(auth, "analytics.financial")) {
    throw new AppError(403, "FORBIDDEN", "You do not have permission for this action.");
  }
  const timeZone = await studioTimezone();
  const { start, end } = rangeFromKeys(fromKey, toKey, timeZone);
  const scope = scopeFilter(auth);
  const [deliverables, tasks, reshoots, posts] = await Promise.all([
    Deliverable.find({ ...scope, createdAt: { $gte: start, $lte: end } }).lean() as any,
    EditingTask.find({ ...scope, completedAt: { $gte: start, $lte: end }, status: "approved" }).lean() as any,
    Reshoot.find({ ...scope, createdAt: { $gte: start, $lte: end } }).lean() as any,
    PublishingTask.find({ ...scope, createdAt: { $gte: start, $lte: end } }).lean() as any,
  ]);
  const durations = tasks.filter((task) => task.claimedAt && task.completedAt).map((task) => (new Date(task.completedAt as Date).getTime() - new Date(task.claimedAt as Date).getTime()) / 36e5);
  const published = posts.filter((post) => post.status === "published");
  const onTime = published.filter((post) => post.scheduledAt && post.publishedAt && post.publishedAt.getTime() <= post.scheduledAt.getTime() + 60 * 60000).length;
  const byStatus = deliverables.reduce((acc: Record<string, number>, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});
  const byReason = reshoots.reduce((acc: Record<string, number>, item) => {
    acc[item.reason] = (acc[item.reason] ?? 0) + 1;
    return acc;
  }, {});
  return {
    deliverables: byStatus,
    uniqueDeliverables: deliverables.length,
    averageTurnaroundHours: durations.length ? Math.round((durations.reduce((sum, value) => sum + value, 0) / durations.length) * 10) / 10 : null,
    reshoots: byReason,
    publishing: { total: posts.length, published: published.length, failed: posts.filter((post) => post.status === "failed").length, onTime },
  };
}

export async function performanceReport(auth: AuthContext, fromKey: string, toKey: string) {
  if (!hasPermission(auth, "analytics.view") && !auth.isSuperAdmin) throw new AppError(403, "FORBIDDEN", "You do not have permission for this action.");
  const timeZone = await studioTimezone();
  const { start, end } = rangeFromKeys(fromKey, toKey, timeZone);
  const [settingsEmployees, shoots, deliverables, posts] = await Promise.all([
    Employee.find({ employmentStatus: "active" }).select("firstName lastName employeeCode userId roleId").lean() as any,
    Shoot.find({ status: "submitted", actualEnd: { $gte: start, $lte: end } }).lean() as any,
    Deliverable.find({ updatedAt: { $gte: start, $lte: end } }).lean() as any,
    PublishingTask.find({ status: "published", publishedAt: { $gte: start, $lte: end } }).lean() as any,
  ]);
  const { Settings } = await import("../models");
  const settings = await Settings.findOne({ key: "studio" }).lean() as any;
  return {
    targets: settings?.performanceTargets ?? {},
    targetNote: "Targets stay empty until a super admin sets them. Actuals are counted from records in the selected period.",
    people: settingsEmployees.map((employee) => ({
      id: employee._id,
      name: `${employee.firstName} ${employee.lastName}`,
      employeeCode: employee.employeeCode,
      shootsCompleted: shoots.filter((shoot) => String(shoot.cinematographerId) === String(employee._id)).length,
      approvedOutputs: deliverables.filter((item) => String(item.assignedEditorId) === String(employee.userId) && ["approved", "ready_to_publish", "published"].includes(item.status)).length,
      revisions: deliverables.filter((item) => String(item.assignedEditorId) === String(employee.userId)).reduce((sum, item) => sum + item.revisionCount, 0),
      postsPublished: posts.filter((post) => String(post.assignedTo) === String(employee.userId)).length,
    })),
  };
}

export async function searchRecords(auth: AuthContext, q: string) {
  if (!hasPermission(auth, "search.view")) throw new AppError(403, "FORBIDDEN", "You do not have permission for this action.");
  const term = escapeRegex(q.trim());
  if (term.length < 2) return { clients: [], projects: [], deliverables: [], invoices: [], employees: [] };
  const regex = { $regex: term, $options: "i" };
  const scope = scopeFilter(auth);
  const [clients, projects, deliverables, invoices, employees] = await Promise.all([
    hasPermission(auth, "clients.view") ? Client.find({ ...(auth.scopeClientIds.length && !auth.isSuperAdmin ? { _id: { $in: auth.scopeClientIds } } : {}), $or: [{ name: regex }, { clientCode: regex }] }).limit(6).lean() as any : [],
    hasPermission(auth, "projects.view") ? Project.find({ ...scope, $or: [{ name: regex }, { projectCode: regex }] }).limit(6).lean() as any : [],
    hasPermission(auth, "deliverables.view") ? Deliverable.find({ ...scope, $or: [{ title: regex }, { deliverableCode: regex }] }).limit(6).lean() as any : [],
    hasPermission(auth, "invoices.view") ? Invoice.find({ ...scope, invoiceNumber: regex }).limit(6).lean() as any : [],
    hasPermission(auth, "employees.view") ? Employee.find({ $or: [{ firstName: regex }, { lastName: regex }, { employeeCode: regex }] }).select("firstName lastName employeeCode designation").limit(6).lean() as any : [],
  ]);
  return { clients, projects, deliverables, invoices, employees };
}

export async function listNotifications(auth: AuthContext) {
  const { Notification } = await import("../models");
  return Notification.find({ userId: auth.userId }).sort({ createdAt: -1 }).limit(40).lean() as any;
}

export async function markNotification(auth: AuthContext, id: string) {
  const { Notification } = await import("../models");
  await Notification.updateOne({ _id: id, userId: auth.userId }, { readAt: new Date() });
}

export async function markAllNotifications(auth: AuthContext) {
  const { Notification } = await import("../models");
  await Notification.updateMany({ userId: auth.userId, readAt: null }, { readAt: new Date() });
}

export async function listAudit(query: Record<string, unknown>) {
  const { AuditLog } = await import("../models");
  const filter: Record<string, unknown> = {};
  if (typeof query.entityType === "string" && query.entityType) filter.entityType = query.entityType;
  return AuditLog.find(filter).sort({ createdAt: -1 }).limit(100).lean() as any;
}

export async function updateSettings(auth: AuthContext, input: Record<string, unknown>) {
  const { Settings } = await import("../models");
  const before = await Settings.findOne({ key: "studio" }).lean() as any;
  const settings = await Settings.findOneAndUpdate({ key: "studio" }, { $set: input }, { new: true });
  const { audit } = await import("../platform");
  await audit({ actorId: auth.userId, action: "settings.updated", entityType: "settings", entityId: "studio", before, after: input });
  return settings?.toObject();
}

export async function publicSettings() {
  const { Settings } = await import("../models");
  const settings = await Settings.findOne({ key: "studio" }).lean() as any;
  return { legalName: settings?.legalName, businessTimezone: settings?.businessTimezone, currency: settings?.currency };
}
