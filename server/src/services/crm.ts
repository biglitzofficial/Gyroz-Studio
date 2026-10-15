import { assertClientAccess, hasPermission, scopeFilter, type AuthContext } from "../auth";
import { AppError, escapeRegex, pageParams, sortSpec } from "../http";
import { Activity, Client, Deliverable, Invoice, Payment, PricingRule, Project } from "../models";
import { allowedProjectTransitions, assertProjectTransition, type ProjectStatus } from "../domain/workflow";
import { activity, audit, nextCode } from "../platform";
import { presentInvoiceStatus } from "../domain/money";

function presentClient(doc: Record<string, unknown>) {
  return {
    id: String(doc._id),
    clientCode: doc.clientCode,
    name: doc.name,
    kind: doc.kind,
    contactPerson: doc.contactPerson,
    phone: doc.phone,
    email: doc.email,
    billingAddress: doc.billingAddress,
    gstin: doc.gstin,
    status: doc.status,
    pricingModel: doc.pricingModel,
    contacts: doc.contacts ?? [],
    agreementRef: doc.agreementRef,
    notes: doc.notes,
    requiresClientApproval: doc.requiresClientApproval,
    createdAt: doc.createdAt,
  };
}

export async function listClients(auth: AuthContext, query: Record<string, unknown>) {
  const { page, limit, skip } = pageParams(query);
  const filter: Record<string, unknown> = {};
  if (!auth.isSuperAdmin && auth.scopeClientIds.length) filter._id = { $in: auth.scopeClientIds };
  if (query.status) filter.status = query.status;
  else filter.status = { $ne: "archived" };
  if (typeof query.q === "string" && query.q.trim()) {
    const q = escapeRegex(query.q.trim());
    filter.$or = [{ name: { $regex: q, $options: "i" } }, { clientCode: { $regex: q, $options: "i" } }, { email: { $regex: q, $options: "i" } }];
  }
  const sort = sortSpec(query.sort, ["name", "createdAt", "clientCode"], "name");
  const [rows, total] = await Promise.all([
    Client.find(filter).sort(sort).skip(skip).limit(limit).lean() as any,
    Client.countDocuments(filter),
  ]);
  return { rows: rows.map((row) => presentClient(row as unknown as Record<string, unknown>)), meta: { page, limit, total } };
}

export async function createClient(auth: AuthContext, input: Record<string, unknown>) {
  const clientCode = await nextCode("client", "GY-C");
  const client = await Client.create({ ...input, clientCode });
  await audit({ actorId: auth.userId, action: "client.created", entityType: "client", entityId: String(client._id), after: { name: client.name, clientCode } });
  await activity({ clientId: client._id, actorId: auth.userId, verb: "client.created", summary: `Client ${client.name} was added.` });
  return presentClient(client.toObject() as unknown as Record<string, unknown>);
}

export async function updateClient(auth: AuthContext, id: string, input: Record<string, unknown>) {
  const client = await Client.findById(id);
  if (!client) throw new AppError(404, "NOT_FOUND", "Client not found.");
  assertClientAccess(auth, client._id);
  const before = { name: client.name, status: client.status };
  Object.assign(client, input);
  await client.save();
  await audit({ actorId: auth.userId, action: "client.updated", entityType: "client", entityId: id, before, after: { name: client.name, status: client.status } });
  return presentClient(client.toObject() as unknown as Record<string, unknown>);
}

export async function getClient(auth: AuthContext, id: string) {
  const client = await Client.findById(id).lean() as any;
  if (!client) throw new AppError(404, "NOT_FOUND", "Client not found.");
  assertClientAccess(auth, client._id);
  const finance = hasPermission(auth, "invoices.view") || hasPermission(auth, "analytics.financial");
  const [projects, deliverables, invoices, payments, timeline] = await Promise.all([
    Project.find({ clientId: id }).sort({ createdAt: -1 }).lean() as any,
    Deliverable.find({ clientId: id }).sort({ createdAt: -1 }).limit(100).lean() as any,
    finance ? Invoice.find({ clientId: id }).sort({ createdAt: -1 }).lean() as any : [],
    finance ? Payment.find({ clientId: id }).sort({ paidAt: -1 }).lean() as any : [],
    Activity.find({ clientId: id }).sort({ createdAt: -1 }).limit(40).lean() as any,
  ]);
  const outstandingPaise = finance
    ? (invoices as Array<{ status: string; totalPaise: number; paidPaise: number }>).filter((invoice) => ["issued", "partially_paid", "paid"].includes(invoice.status)).reduce((sum, invoice) => sum + (invoice.totalPaise - invoice.paidPaise), 0)
    : undefined;
  return {
    client: presentClient(client as unknown as Record<string, unknown>),
    projects,
    deliverables,
    invoices: finance ? (invoices as Array<{ status: "draft" | "pending_approval" | "approved" | "issued" | "partially_paid" | "paid" | "void"; dueDate?: Date; totalPaise: number; paidPaise: number }>).map((invoice) => ({ ...invoice, displayStatus: presentInvoiceStatus(invoice.status, invoice.dueDate ?? null, invoice.totalPaise, invoice.paidPaise) })) : undefined,
    payments: finance ? payments : undefined,
    outstandingPaise,
    timeline,
  };
}

export async function listProjects(auth: AuthContext, query: Record<string, unknown>) {
  const { page, limit, skip } = pageParams(query);
  const filter: Record<string, unknown> = { ...scopeFilter(auth) };
  if (query.clientId) filter.clientId = query.clientId;
  if (query.status) filter.status = query.status;
  if (typeof query.q === "string" && query.q.trim()) {
    const q = escapeRegex(query.q.trim());
    filter.$or = [{ name: { $regex: q, $options: "i" } }, { projectCode: { $regex: q, $options: "i" } }];
  }
  const [rows, total] = await Promise.all([
    Project.find(filter).sort(sortSpec(query.sort, ["name", "createdAt", "endDate", "status"], "-createdAt")).skip(skip).limit(limit).lean() as any,
    Project.countDocuments(filter),
  ]);
  return { rows, meta: { page, limit, total } };
}

export async function createProject(auth: AuthContext, input: { clientId: string; name: string; description?: string; serviceType?: string; startDate?: string; endDate?: string; priority?: string; managerId?: string; budgetPaise?: number; requiresClientApproval?: boolean; notes?: string }) {
  const client = await Client.findById(input.clientId);
  if (!client || client.status === "archived") throw new AppError(400, "VALIDATION", "Choose an active client.");
  assertClientAccess(auth, client._id);
  const project = await Project.create({
    ...input,
    projectCode: await nextCode("project", "GY-P"),
    requiresClientApproval: input.requiresClientApproval ?? client.requiresClientApproval,
    budgetPaise: input.budgetPaise ?? 0,
  });
  await activity({ clientId: project.clientId, projectId: project._id, actorId: auth.userId, verb: "project.created", summary: `Project ${project.name} opened for ${client.name}.` });
  await audit({ actorId: auth.userId, action: "project.created", entityType: "project", entityId: String(project._id), after: { name: project.name, clientId: project.clientId } });
  return project.toObject();
}

export async function getProject(auth: AuthContext, id: string) {
  const project = await Project.findById(id).lean() as any;
  if (!project) throw new AppError(404, "NOT_FOUND", "Project not found.");
  assertClientAccess(auth, project.clientId, project._id);
  const [deliverables, timeline] = await Promise.all([
    Deliverable.find({ projectId: id }).lean() as any,
    Activity.find({ projectId: id }).sort({ createdAt: -1 }).limit(40).lean() as any,
  ]);
  const counts = deliverables.reduce((acc: Record<string, number>, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});
  return { project, deliverables, counts, timeline, allowedTransitions: allowedProjectTransitions(project.status as ProjectStatus) };
}

export async function updateProject(auth: AuthContext, id: string, input: Record<string, unknown>) {
  const project = await Project.findById(id);
  if (!project) throw new AppError(404, "NOT_FOUND", "Project not found.");
  assertClientAccess(auth, project.clientId, project._id);
  if ("status" in input) delete input.status;
  Object.assign(project, input);
  await project.save();
  return project.toObject();
}

export async function transitionProject(auth: AuthContext, id: string, status: ProjectStatus) {
  const project = await Project.findById(id);
  if (!project) throw new AppError(404, "NOT_FOUND", "Project not found.");
  assertClientAccess(auth, project.clientId, project._id);
  assertProjectTransition(project.status as ProjectStatus, status);
  const before = project.status;
  project.status = status;
  await project.save();
  await activity({ clientId: project.clientId, projectId: project._id, actorId: auth.userId, verb: "project.transition", summary: `${project.name} moved from ${before} to ${status}.` });
  await audit({ actorId: auth.userId, action: "project.transition", entityType: "project", entityId: id, before: { status: before }, after: { status } });
  return getProject(auth, id);
}

export async function listPricing(auth: AuthContext, clientId?: string) {
  const filter: Record<string, unknown> = {};
  if (clientId) {
    assertClientAccess(auth, clientId);
    filter.clientId = clientId;
  }
  return PricingRule.find(filter).sort({ serviceType: 1 }).lean() as any;
}

export async function savePricing(auth: AuthContext, input: { id?: string; clientId?: string; projectId?: string; serviceType: string; label: string; unitPricePaise: number; active?: boolean }) {
  if (!auth.isSuperAdmin && !hasPermission(auth, "settings.manage")) {
    throw new AppError(403, "FORBIDDEN", "Pricing rules are controlled by a super admin.");
  }
  if (input.clientId) assertClientAccess(auth, input.clientId, input.projectId);
  if (input.id) {
    const rule = await PricingRule.findById(input.id);
    if (!rule) throw new AppError(404, "NOT_FOUND", "Pricing rule not found.");
    const before = { unitPricePaise: rule.unitPricePaise, label: rule.label };
    Object.assign(rule, input);
    await rule.save();
    await audit({ actorId: auth.userId, action: "pricing.updated", entityType: "pricing_rule", entityId: String(rule._id), before, after: { unitPricePaise: rule.unitPricePaise, label: rule.label } });
    return rule.toObject();
  }
  const rule = await PricingRule.create(input);
  await audit({ actorId: auth.userId, action: "pricing.created", entityType: "pricing_rule", entityId: String(rule._id), after: input });
  return rule.toObject();
}

export async function clientExists(id: string) {
  if (!/^[a-f\d]{24}$/i.test(id)) return null;
  return Client.findById(id);
}
