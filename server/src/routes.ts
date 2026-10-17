import { Router } from "express";
import express from "express";
import fs from "fs";
import { z } from "zod";
import { requireAnyPermission, requireAuth, requirePermission } from "./auth";
import { env } from "./config";
import { AppError, asyncRoute, ok, readInput, validate } from "./http";
import { seedDemo } from "./seed";
import * as identity from "./services/identity";
import * as crm from "./services/crm";
import * as production from "./services/production";
import * as finance from "./services/finance";
import * as people from "./services/people";
import * as insights from "./services/insights";
import * as plans from "./services/plans";
import * as storage from "./services/storage";
import { wipeStudio } from "./services/wipe";
import * as assets from "./services/assets";
import { workReport } from "./services/work";
import { getSettings, phoneApiHosts } from "./platform";
import { PERMISSION_CATALOG } from "./domain/permissions";
import { PROJECT_STATUSES, RESHOOT_REASONS } from "./domain/workflow";
import { resolveLocalPath } from "./services/storage";
import { toCsv } from "./platform";
import { Invoice, Attendance, Employee } from "./models";
import { subscribe } from "./live";

const wrap = <T extends z.ZodRawShape>(body: T) => z.object({ body: z.object(body), query: z.object({}).passthrough(), params: z.object({}).passthrough() });

export const api = Router();

api.get("/health", (_req, res) => res.json(ok({ ok: true, service: "gyroz-studio" })));

api.get("/live", requireAuth, (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`: ${" ".repeat(2048)}\n\n`);
  const unsubscribe = subscribe((event) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  const beat = setInterval(() => {
    if (!res.writableEnded) res.write(": ping\n\n");
  }, 20000);
  req.on("close", () => {
    clearInterval(beat);
    unsubscribe();
  });
});

function forClient<T extends { refreshToken?: string }>(req: { get(name: string): string | undefined }, result: T) {
  if (req.get("x-gyroz-app") === "1") return result;
  const { refreshToken: _refresh, ...web } = result;
  return web;
}

function refreshTokenFrom(req: { cookies?: { gyroz_refresh?: string }; body?: { refreshToken?: unknown } }) {
  if (typeof req.cookies?.gyroz_refresh === "string" && req.cookies.gyroz_refresh) return req.cookies.gyroz_refresh;
  return typeof req.body?.refreshToken === "string" ? req.body.refreshToken : undefined;
}

api.post("/auth/login", validate(identity.loginSchema), asyncRoute(async (req, res) => {
  const { body } = readInput(req, identity.loginSchema);
  const result = await identity.login(body.email, body.password, req.ip ?? "local", res);
  res.json(ok(forClient(req, result)));
}));

api.post("/auth/refresh", asyncRoute(async (req, res) => {
  res.json(ok(forClient(req, await identity.refresh(refreshTokenFrom(req), res))));
}));

api.post("/auth/logout", asyncRoute(async (req, res) => {
  await identity.logout(refreshTokenFrom(req), res);
  res.json(ok({ signedOut: true }));
}));

api.get("/auth/me", requireAuth, asyncRoute(async (req, res) => {
  const settings = await insights.publicSettings();
  const { publicUser } = await import("./auth");
  res.json(ok({ ...(await publicUser(req.auth!.userId)), studio: settings }));
}));

api.patch("/auth/password", requireAuth, validate(identity.passwordChangeSchema), asyncRoute(async (req, res) => {
  const { body } = readInput(req, identity.passwordChangeSchema);
  const result = await identity.changePassword(req.auth!, body.currentPassword, body.nextPassword);
  const { setRefreshCookie } = await import("./auth");
  setRefreshCookie(res, result.refreshToken);
  res.json(ok(forClient(req, result)));
}));

api.patch("/auth/profile", requireAuth, validate(identity.profileSchema), asyncRoute(async (req, res) => {
  const { body } = readInput(req, identity.profileSchema);
  res.json(ok(await identity.updateProfile(req.auth!, body.name)));
}));

api.get("/permissions", requireAuth, requirePermission("roles.manage"), (_req, res) => res.json(ok(PERMISSION_CATALOG)));
api.get("/roles", requireAuth, requirePermission("roles.manage"), asyncRoute(async (_req, res) => res.json(ok(await identity.listRoles()))));
api.get("/roles/options", requireAuth, requireAnyPermission("employees.create", "roles.manage"), asyncRoute(async (_req, res) => {
  const roles = await identity.listRoles();
  res.json(ok(roles.map((role) => ({ id: role.id, name: role.name, slug: role.slug }))));
}));
const roleBody = { name: z.string().trim().min(2).max(40).regex(/[A-Za-z]/), description: z.string().trim().max(240).optional(), permissions: z.array(z.string()).max(80) };
api.post("/roles", requireAuth, requirePermission("roles.manage"), validate(wrap(roleBody)), asyncRoute(async (req, res) => {
  const { body } = readInput(req, wrap(roleBody));
  res.status(201).json(ok(await identity.saveRole(req.auth!, body)));
}));
api.patch("/roles/:id", requireAuth, requirePermission("roles.manage"), validate(wrap(roleBody)), asyncRoute(async (req, res) => {
  const { body } = readInput(req, wrap(roleBody));
  res.json(ok(await identity.saveRole(req.auth!, body, req.params.id)));
}));
api.patch("/users/:id/access", requireAuth, requirePermission("roles.manage"), validate(wrap({ roleId: z.string().optional(), status: z.enum(["active", "disabled"]).optional(), scopeClientIds: z.array(z.string()).optional(), scopeProjectIds: z.array(z.string()).optional() })), asyncRoute(async (req, res) => {
  const schema = wrap({ roleId: z.string().optional(), status: z.enum(["active", "disabled"]).optional(), scopeClientIds: z.array(z.string()).optional(), scopeProjectIds: z.array(z.string()).optional() });
  const { body } = readInput(req, schema);
  res.json(ok(await identity.updateUserAccess(req.auth!, req.params.id, body)));
}));

const clientBody = {
  name: z.string().trim().min(2).max(80).regex(/[A-Za-z]/),
  kind: z.enum(["company", "individual"]).optional(),
  contactPerson: z.string().trim().min(2).max(60).regex(/^[A-Za-z][A-Za-z .'-]*$/),
  phone: z.string().trim().regex(/^\d{10}$/),
  email: z.string().trim().email().max(120),
  billingAddress: z.string().trim().min(5).max(240),
  gstin: z.string().trim().toUpperCase().regex(/^$|^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/).optional(),
  status: z.enum(["active", "paused", "archived"]).optional(),
  pricingModel: z.enum(["project", "per_output", "package", "retainer"]).optional(),
  agreementRef: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(500).optional(),
  requiresClientApproval: z.boolean().optional(),
};
api.get("/clients", requireAuth, requirePermission("clients.view"), asyncRoute(async (req, res) => {
  const result = await crm.listClients(req.auth!, req.query as Record<string, unknown>);
  res.json(ok(result.rows, result.meta));
}));
api.post("/clients", requireAuth, requirePermission("clients.create"), validate(wrap(clientBody)), asyncRoute(async (req, res) => {
  const { body } = readInput(req, wrap(clientBody));
  res.status(201).json(ok(await crm.createClient(req.auth!, body)));
}));
api.get("/clients/:id", requireAuth, requirePermission("clients.view"), asyncRoute(async (req, res) => res.json(ok(await crm.getClient(req.auth!, req.params.id)))));
api.patch("/clients/:id", requireAuth, requirePermission("clients.edit"), validate(z.object({ body: z.object(clientBody).partial(), query: z.object({}).passthrough(), params: z.object({}).passthrough() })), asyncRoute(async (req, res) => {
  const schema = z.object({ body: z.object(clientBody).partial(), query: z.object({}).passthrough(), params: z.object({}).passthrough() });
  const { body } = readInput(req, schema);
  res.json(ok(await crm.updateClient(req.auth!, req.params.id, body)));
}));

const projectBody = { clientId: z.string().min(1), name: z.string().trim().min(2).max(80), description: z.string().trim().max(500).optional(), serviceType: z.string().trim().max(40).optional(), startDate: z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/).optional(), endDate: z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/).optional(), priority: z.enum(["low", "normal", "high", "urgent"]).optional(), managerId: z.string().optional(), budgetPaise: z.number().int().nonnegative().max(100_000_000_00).optional(), requiresClientApproval: z.boolean().optional(), notes: z.string().trim().max(500).optional() };
api.get("/projects", requireAuth, requirePermission("projects.view"), asyncRoute(async (req, res) => {
  const result = await crm.listProjects(req.auth!, req.query as Record<string, unknown>);
  res.json(ok(result.rows, result.meta));
}));
api.post("/projects", requireAuth, requirePermission("projects.create"), validate(wrap(projectBody)), asyncRoute(async (req, res) => {
  const { body } = readInput(req, wrap(projectBody));
  res.status(201).json(ok(await crm.createProject(req.auth!, body)));
}));
api.get("/projects/:id", requireAuth, requirePermission("projects.view"), asyncRoute(async (req, res) => res.json(ok(await crm.getProject(req.auth!, req.params.id)))));
api.patch("/projects/:id", requireAuth, requirePermission("projects.edit"), validate(wrap(projectBody)), asyncRoute(async (req, res) => {
  const { body } = readInput(req, wrap(projectBody));
  res.json(ok(await crm.updateProject(req.auth!, req.params.id, body)));
}));
api.post("/projects/:id/transition", requireAuth, requirePermission("projects.edit"), validate(wrap({ status: z.enum(PROJECT_STATUSES) })), asyncRoute(async (req, res) => {
  const { body } = readInput(req, wrap({ status: z.enum(PROJECT_STATUSES) }));
  res.json(ok(await crm.transitionProject(req.auth!, req.params.id, body.status)));
}));

api.get("/pricing-rules", requireAuth, requireAnyPermission("invoices.view", "settings.manage"), asyncRoute(async (req, res) => res.json(ok(await crm.listPricing(req.auth!, typeof req.query.clientId === "string" ? req.query.clientId : undefined)))));
api.post("/pricing-rules", requireAuth, requirePermission("settings.manage"), validate(wrap({ clientId: z.string().optional(), projectId: z.string().optional(), serviceType: z.string().min(2), label: z.string().min(2), unitPricePaise: z.number().int().nonnegative(), active: z.boolean().optional() })), asyncRoute(async (req, res) => {
  const schema = wrap({ clientId: z.string().optional(), projectId: z.string().optional(), serviceType: z.string().min(2), label: z.string().min(2), unitPricePaise: z.number().int().nonnegative(), active: z.boolean().optional() });
  const { body } = readInput(req, schema);
  res.status(201).json(ok(await crm.savePricing(req.auth!, body)));
}));

const shootBody = { clientId: z.string().min(1), projectId: z.string().min(1), scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), plannedStart: z.string().regex(/^$|^\d{2}:\d{2}$/).optional(), plannedEnd: z.string().regex(/^$|^\d{2}:\d{2}$/).optional(), location: z.string().trim().max(120).optional(), cinematographerId: z.string().min(1), crewIds: z.array(z.string()).max(12).optional(), brief: z.string().trim().max(500).optional(), plannedOutputCount: z.number().int().min(1).max(20).optional(), priority: z.enum(["low", "normal", "high", "urgent"]).optional() };
api.get("/shoots", requireAuth, requirePermission("shoots.view"), asyncRoute(async (req, res) => {
  const result = await production.listShoots(req.auth!, req.query as Record<string, unknown>);
  res.json(ok(result.rows, result.meta));
}));
api.post("/shoots", requireAuth, requirePermission("shoots.create"), validate(wrap(shootBody)), asyncRoute(async (req, res) => {
  const { body } = readInput(req, wrap(shootBody));
  res.status(201).json(ok(await production.createShoot(req.auth!, body)));
}));
api.get("/shoots/:id", requireAuth, requirePermission("shoots.view"), asyncRoute(async (req, res) => res.json(ok(await production.getShoot(req.auth!, req.params.id)))));
api.post("/shoots/:id/start", requireAuth, requirePermission("shoots.log"), asyncRoute(async (req, res) => res.json(ok(await production.startShoot(req.auth!, req.params.id)))));
const fieldReportBody = { location: z.string().trim().min(2).max(120), hoursSpent: z.number().positive().max(48), report: z.string().trim().min(2).max(500), expenses: z.array(z.object({ category: z.enum(["travel", "food", "equipment", "production", "other"]), description: z.string().trim().min(2).max(160), amountPaise: z.number().int().positive().max(100_000_000_00) })).max(8).optional() };
api.post("/shoots/:id/report", requireAuth, requirePermission("shoots.log"), validate(wrap(fieldReportBody)), asyncRoute(async (req, res) => {
  const { body } = readInput(req, wrap(fieldReportBody));
  res.json(ok(await production.saveFieldReport(req.auth!, req.params.id, body)));
}));
api.post("/shoots/:id/progress", requireAuth, requirePermission("shoots.log"), validate(wrap({ note: z.string().trim().min(2).max(240), location: z.string().trim().max(120).optional() })), asyncRoute(async (req, res) => {
  const schema = wrap({ note: z.string().trim().min(2).max(240), location: z.string().trim().max(120).optional() });
  const { body } = readInput(req, schema);
  res.json(ok(await production.logShootProgress(req.auth!, req.params.id, body)));
}));
api.post("/shoots/:id/submit", requireAuth, requirePermission("shoots.log"), validate(wrap({ usableFootageCount: z.number().int().nonnegative(), notes: z.string().optional(), blockers: z.string().optional(), sourceReferences: z.array(z.object({ label: z.string().optional(), url: z.string().optional() })).optional(), outputs: z.array(z.object({ title: z.string().min(2), type: z.string().optional(), platform: z.string().optional(), brief: z.string().optional(), aspectRatio: z.string().optional(), deadline: z.string().optional(), priority: z.enum(["low", "normal", "high", "urgent"]).optional() })).optional() })), asyncRoute(async (req, res) => {
  const schema = wrap({ usableFootageCount: z.number().int().nonnegative(), notes: z.string().optional(), blockers: z.string().optional(), sourceReferences: z.array(z.object({ label: z.string().optional(), url: z.string().optional() })).optional(), outputs: z.array(z.object({ title: z.string().min(2), type: z.string().optional(), platform: z.string().optional(), brief: z.string().optional(), aspectRatio: z.string().optional(), deadline: z.string().optional(), priority: z.enum(["low", "normal", "high", "urgent"]).optional() })).optional() });
  const { body } = readInput(req, schema);
  res.json(ok(await production.submitShoot(req.auth!, req.params.id, body)));
}));

const planBody = { kind: z.enum(["shoot", "editing", "publishing", "other"]), title: z.string().trim().min(2).max(80), dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(), endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(), assigneeEmployeeId: z.string().min(1), projectId: z.string().optional(), location: z.string().trim().max(120).optional(), notes: z.string().trim().max(500).optional() };
api.get("/plans", requireAuth, requirePermission("plans.view"), asyncRoute(async (req, res) => res.json(ok(await plans.listPlans(req.auth!, req.query as Record<string, unknown>)))));
api.post("/plans", requireAuth, requirePermission("plans.assign"), validate(wrap(planBody)), asyncRoute(async (req, res) => {
  const { body } = readInput(req, wrap(planBody));
  res.status(201).json(ok(await plans.createPlan(req.auth!, body)));
}));
api.post("/plans/:id/cancel", requireAuth, requirePermission("plans.assign"), asyncRoute(async (req, res) => res.json(ok(await plans.cancelPlan(req.auth!, req.params.id)))));
api.post("/shoots/:id/cancel", requireAuth, requireAnyPermission("plans.assign", "shoots.create"), asyncRoute(async (req, res) => res.json(ok(await plans.cancelScheduledShoot(req.auth!, req.params.id)))));

api.get("/deliverables", requireAuth, requirePermission("deliverables.view"), asyncRoute(async (req, res) => {
  const result = await production.listDeliverables(req.auth!, req.query as Record<string, unknown>);
  res.json(ok(result.rows, result.meta));
}));
api.get("/deliverables/:id", requireAuth, requirePermission("deliverables.view"), asyncRoute(async (req, res) => res.json(ok(await production.getDeliverable(req.auth!, req.params.id)))));
api.get("/editing/queue", requireAuth, requirePermission("editing.view"), asyncRoute(async (req, res) => res.json(ok(await production.listQueue(req.auth!, req.query as Record<string, unknown>)))));
api.post("/editing/:id/claim", requireAuth, requirePermission("editing.claim"), asyncRoute(async (req, res) => res.json(ok(await production.claimTask(req.auth!, req.params.id)))));
api.post("/editing/:id/start", requireAuth, requirePermission("editing.submit"), asyncRoute(async (req, res) => res.json(ok(await production.startTask(req.auth!, req.params.id)))));
api.post("/editing/:id/progress", requireAuth, requirePermission("editing.submit"), validate(wrap({ hoursSpent: z.number().positive().max(200), outcome: z.string().trim().min(2).max(240) })), asyncRoute(async (req, res) => {
  const schema = wrap({ hoursSpent: z.number().positive().max(200), outcome: z.string().trim().min(2).max(240) });
  const { body } = readInput(req, schema);
  res.json(ok(await production.logTaskProgress(req.auth!, req.params.id, body)));
}));
api.post("/editing/:id/hold", requireAuth, requirePermission("editing.submit"), validate(wrap({ reason: z.string().min(2) })), asyncRoute(async (req, res) => {
  const { body } = readInput(req, wrap({ reason: z.string().min(2) }));
  res.json(ok(await production.holdTask(req.auth!, req.params.id, body.reason)));
}));
api.post("/editing/:id/resume", requireAuth, requirePermission("editing.submit"), asyncRoute(async (req, res) => res.json(ok(await production.resumeTask(req.auth!, req.params.id)))));
api.post("/editing/:id/release", requireAuth, requirePermission("editing.submit"), asyncRoute(async (req, res) => res.json(ok(await production.releaseTask(req.auth!, req.params.id)))));
api.post("/editing/:id/submit", requireAuth, requirePermission("editing.submit"), validate(wrap({ notes: z.string().trim().max(240).optional(), hoursSpent: z.number().positive().max(200).optional(), exportReferences: z.array(z.object({ label: z.string().optional(), url: z.string().min(4) })).optional() })), asyncRoute(async (req, res) => {
  const schema = wrap({ notes: z.string().trim().max(240).optional(), hoursSpent: z.number().positive().max(200).optional(), exportReferences: z.array(z.object({ label: z.string().optional(), url: z.string().min(4) })).optional() });
  const { body } = readInput(req, schema);
  res.json(ok(await production.submitTask(req.auth!, req.params.id, body)));
}));
api.post("/editing/:id/reassign", requireAuth, requirePermission("editing.reassign"), validate(wrap({ toUserId: z.string(), reason: z.string().min(2) })), asyncRoute(async (req, res) => {
  const { body } = readInput(req, wrap({ toUserId: z.string(), reason: z.string().min(2) }));
  res.json(ok(await production.reassignTask(req.auth!, req.params.id, body.toUserId, body.reason)));
}));
api.post("/deliverables/:id/reviews", requireAuth, requirePermission("editing.review"), validate(wrap({ decision: z.enum(["approved", "rework"]), feedback: z.string().optional() })), asyncRoute(async (req, res) => {
  const { body } = readInput(req, wrap({ decision: z.enum(["approved", "rework"]), feedback: z.string().optional() }));
  res.json(ok(await production.reviewDeliverable(req.auth!, req.params.id, body)));
}));
api.post("/deliverables/:id/client-approval", requireAuth, requirePermission("editing.review"), validate(wrap({ feedback: z.string().optional() })), asyncRoute(async (req, res) => {
  const { body } = readInput(req, wrap({ feedback: z.string().optional() }));
  res.json(ok(await production.clientApprove(req.auth!, req.params.id, body.feedback)));
}));

api.get("/reshoots", requireAuth, requirePermission("reshoots.view"), asyncRoute(async (req, res) => res.json(ok(await production.listReshoots(req.auth!, req.query as Record<string, unknown>)))));
api.post("/reshoots", requireAuth, requirePermission("reshoots.create"), validate(wrap({ deliverableId: z.string(), reason: z.enum(RESHOOT_REASONS), notes: z.string().optional() })), asyncRoute(async (req, res) => {
  const { body } = readInput(req, wrap({ deliverableId: z.string(), reason: z.enum(RESHOOT_REASONS), notes: z.string().optional() }));
  res.status(201).json(ok(await production.createReshoot(req.auth!, body)));
}));
api.post("/reshoots/:id/decision", requireAuth, requirePermission("reshoots.approve"), validate(wrap({ approvalStatus: z.enum(["approved", "rejected"]), billableDecision: z.enum(["pending", "approved", "waived", "partial"]).optional(), chargePaise: z.number().int().nonnegative().optional(), communicationNote: z.string().optional() })), asyncRoute(async (req, res) => {
  const schema = wrap({ approvalStatus: z.enum(["approved", "rejected"]), billableDecision: z.enum(["pending", "approved", "waived", "partial"]).optional(), chargePaise: z.number().int().nonnegative().optional(), communicationNote: z.string().optional() });
  const { body } = readInput(req, schema);
  res.json(ok(await production.decideReshoot(req.auth!, req.params.id, body)));
}));
api.post("/reshoots/:id/schedule", requireAuth, requirePermission("shoots.create"), validate(wrap({ scheduledDate: z.string(), cinematographerId: z.string(), location: z.string().optional(), plannedStart: z.string().optional(), plannedEnd: z.string().optional() })), asyncRoute(async (req, res) => {
  const schema = wrap({ scheduledDate: z.string(), cinematographerId: z.string(), location: z.string().optional(), plannedStart: z.string().optional(), plannedEnd: z.string().optional() });
  const { body } = readInput(req, schema);
  res.json(ok(await production.scheduleReshoot(req.auth!, req.params.id, body)));
}));

api.get("/publishing", requireAuth, requirePermission("publishing.view"), asyncRoute(async (req, res) => res.json(ok(await production.listPublishing(req.auth!, req.query as Record<string, unknown>)))));
api.post("/publishing/:id/schedule", requireAuth, requirePermission("publishing.schedule"), validate(wrap({ scheduledAt: z.string(), caption: z.string().optional(), notes: z.string().optional(), assignedTo: z.string().optional() })), asyncRoute(async (req, res) => {
  const schema = wrap({ scheduledAt: z.string(), caption: z.string().optional(), notes: z.string().optional(), assignedTo: z.string().optional() });
  const { body } = readInput(req, schema);
  res.json(ok(await production.schedulePost(req.auth!, req.params.id, body)));
}));
api.post("/publishing/:id/publish", requireAuth, requirePermission("publishing.publish"), validate(wrap({ publishedUrl: z.string().url().max(300), platform: z.string().trim().min(2).max(40), aspectRatio: z.string().trim().max(20).optional(), caption: z.string().trim().max(500).optional(), proofAssetId: z.string().optional(), notes: z.string().trim().max(500).optional() })), asyncRoute(async (req, res) => {
  const schema = wrap({ publishedUrl: z.string().url().max(300), platform: z.string().trim().min(2).max(40), aspectRatio: z.string().trim().max(20).optional(), caption: z.string().trim().max(500).optional(), proofAssetId: z.string().optional(), notes: z.string().trim().max(500).optional() });
  const { body } = readInput(req, schema);
  res.json(ok(await production.publishPost(req.auth!, req.params.id, body)));
}));
api.post("/publishing/:id/fail", requireAuth, requirePermission("publishing.publish"), validate(wrap({ reason: z.string().min(2) })), asyncRoute(async (req, res) => {
  const { body } = readInput(req, wrap({ reason: z.string().min(2) }));
  res.json(ok(await production.failPost(req.auth!, req.params.id, body.reason)));
}));
api.post("/publishing/:id/metrics", requireAuth, requirePermission("publishing.publish"), validate(wrap({ views: z.number().int().nonnegative().max(1_000_000_000), likes: z.number().int().nonnegative().max(1_000_000_000), recordedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), note: z.string().trim().max(160).optional() })), asyncRoute(async (req, res) => {
  const schema = wrap({ views: z.number().int().nonnegative().max(1_000_000_000), likes: z.number().int().nonnegative().max(1_000_000_000), recordedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), note: z.string().trim().max(160).optional() });
  const { body } = readInput(req, schema);
  res.json(ok(await production.recordReach(req.auth!, req.params.id, body)));
}));

const line = z.object({ description: z.string().trim().min(2).max(160), quantity: z.number().int().min(1).max(999), unitPricePaise: z.number().int().nonnegative().max(100_000_000_00), discountPaise: z.number().int().nonnegative().max(100_000_000_00).default(0), sourceType: z.enum(["manual", "shoot", "deliverable", "reshoot", "retainer", "other"]).optional(), sourceId: z.string().optional(), serviceType: z.string().trim().max(40).optional() });
const invoiceBody = { clientId: z.string(), projectId: z.string().optional(), dueDate: z.string().optional(), lineItems: z.array(line).min(1), discountPaise: z.number().int().nonnegative().optional(), taxRateBps: z.number().int().min(0).max(10000).optional(), internalNotes: z.string().optional(), clientNotes: z.string().optional() };
api.post("/invoices/calculate", requireAuth, requirePermission("invoices.view"), validate(wrap({ lineItems: z.array(line).min(1), discountPaise: z.number().int().nonnegative().default(0), taxRateBps: z.number().int().min(0).max(10000).default(0) })), asyncRoute(async (req, res) => {
  const schema = wrap({ lineItems: z.array(line).min(1), discountPaise: z.number().int().nonnegative().default(0), taxRateBps: z.number().int().min(0).max(10000).default(0) });
  const { body } = readInput(req, schema);
  res.json(ok(finance.previewInvoice(body)));
}));
api.get("/invoices/billable", requireAuth, requirePermission("invoices.create"), asyncRoute(async (req, res) => res.json(ok(await finance.billableItems(req.auth!, String(req.query.clientId ?? ""))))));
api.get("/invoices", requireAuth, requirePermission("invoices.view"), asyncRoute(async (req, res) => res.json(ok(await finance.listInvoices(req.auth!, req.query as Record<string, unknown>)))));
api.post("/invoices", requireAuth, requirePermission("invoices.create"), validate(wrap(invoiceBody)), asyncRoute(async (req, res) => {
  const { body } = readInput(req, wrap(invoiceBody));
  res.status(201).json(ok(await finance.saveInvoice(req.auth!, undefined, body)));
}));
api.get("/invoices/:id", requireAuth, requirePermission("invoices.view"), asyncRoute(async (req, res) => res.json(ok(await finance.getInvoice(req.auth!, req.params.id)))));
api.get("/invoices/:id/pdf", requireAuth, requirePermission("invoices.view"), asyncRoute(async (req, res) => finance.renderInvoicePdf(req.auth!, req.params.id, res)));
api.patch("/invoices/:id", requireAuth, requirePermission("invoices.edit"), validate(wrap(invoiceBody)), asyncRoute(async (req, res) => {
  const { body } = readInput(req, wrap(invoiceBody));
  res.json(ok(await finance.saveInvoice(req.auth!, req.params.id, body)));
}));
api.post("/invoices/:id/submit", requireAuth, requirePermission("invoices.edit"), asyncRoute(async (req, res) => res.json(ok(await finance.submitInvoice(req.auth!, req.params.id)))));
api.post("/invoices/:id/approve", requireAuth, requirePermission("invoices.approve"), asyncRoute(async (req, res) => res.json(ok(await finance.approveInvoice(req.auth!, req.params.id)))));
api.post("/invoices/:id/issue", requireAuth, requirePermission("invoices.issue"), asyncRoute(async (req, res) => res.json(ok(await finance.issueInvoice(req.auth!, req.params.id)))));
api.post("/invoices/:id/void", requireAuth, requirePermission("invoices.approve"), validate(wrap({ reason: z.string().min(2) })), asyncRoute(async (req, res) => {
  const { body } = readInput(req, wrap({ reason: z.string().min(2) }));
  res.json(ok(await finance.voidInvoice(req.auth!, req.params.id, body.reason)));
}));
api.get("/payments", requireAuth, requirePermission("payments.view"), asyncRoute(async (req, res) => res.json(ok(await finance.listPayments(req.auth!, req.query as Record<string, unknown>)))));
api.post("/payments", requireAuth, requirePermission("payments.record"), validate(wrap({ invoiceId: z.string(), amountPaise: z.number().int().positive(), method: z.string().min(2), reference: z.string().optional(), paidAt: z.string().optional(), note: z.string().optional() })), asyncRoute(async (req, res) => {
  const schema = wrap({ invoiceId: z.string(), amountPaise: z.number().int().positive(), method: z.string().min(2), reference: z.string().optional(), paidAt: z.string().optional(), note: z.string().optional() });
  const { body } = readInput(req, schema);
  res.status(201).json(ok(await finance.recordPayment(req.auth!, body)));
}));
api.get("/expenses", requireAuth, asyncRoute(async (req, res) => res.json(ok(await finance.listExpenses(req.auth!, req.query as Record<string, unknown>)))));
api.post("/expenses", requireAuth, validate(wrap({ dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), category: z.string().min(2).max(40), description: z.string().trim().min(2).max(160), amountPaise: z.number().int().positive().max(100_000_000_00), method: z.string().max(40).optional(), vendor: z.string().trim().max(80).optional(), projectId: z.string().optional(), clientId: z.string().optional(), settlement: z.enum(["unpaid", "paid"]).optional(), notes: z.string().trim().max(500).optional() })), asyncRoute(async (req, res) => {
  const schema = wrap({ dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), category: z.string().min(2).max(40), description: z.string().trim().min(2).max(160), amountPaise: z.number().int().positive().max(100_000_000_00), method: z.string().max(40).optional(), vendor: z.string().trim().max(80).optional(), projectId: z.string().optional(), clientId: z.string().optional(), settlement: z.enum(["unpaid", "paid"]).optional(), notes: z.string().trim().max(500).optional() });
  const { body } = readInput(req, schema);
  res.status(201).json(ok(await finance.createExpense(req.auth!, body)));
}));
api.post("/expenses/:id/decision", requireAuth, validate(wrap({ status: z.enum(["approved", "rejected"]) })), asyncRoute(async (req, res) => {
  const { body } = readInput(req, wrap({ status: z.enum(["approved", "rejected"]) }));
  res.json(ok(await finance.decideExpense(req.auth!, req.params.id, body.status)));
}));

const employeeBody = { firstName: z.string().trim().min(2).max(40).regex(/^[A-Za-z][A-Za-z .'-]*$/), lastName: z.string().trim().min(1).max(40).regex(/^[A-Za-z][A-Za-z .'-]*$/), email: z.string().trim().email().max(120), phone: z.string().trim().regex(/^$|^\d{10}$/).optional(), designation: z.string().trim().max(40).optional(), roleId: z.string().min(1), joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), employmentStatus: z.enum(["active", "on_leave", "inactive"]).optional(), compensation: z.object({ type: z.enum(["daily", "monthly"]), dailyRatePaise: z.number().int().nonnegative(), monthlySalaryPaise: z.number().int().nonnegative(), standardPayableDays: z.number().int().positive().max(31) }).optional(), reportingManagerId: z.string().optional(), teamId: z.string().optional(), shiftId: z.string().optional(), emergencyContact: z.object({ name: z.string().trim().max(60).optional(), phone: z.string().trim().regex(/^$|^\d{10}$/).optional(), relation: z.string().trim().max(40).optional() }).optional(), bank: z.object({ accountName: z.string().trim().max(80).optional(), accountNumber: z.string().trim().regex(/^$|^\d{9,18}$/).optional(), ifsc: z.string().trim().toUpperCase().regex(/^$|^[A-Z]{4}0[A-Z0-9]{6}$/).optional(), bankName: z.string().trim().max(80).optional() }).optional(), notes: z.string().trim().max(500).optional(), createLogin: z.boolean().optional(), temporaryPassword: z.string().min(8).max(72).optional(), mustChangePassword: z.boolean().optional(), scopeClientIds: z.array(z.string()).optional(), scopeProjectIds: z.array(z.string()).optional() };
api.get("/employees", requireAuth, requirePermission("employees.view"), asyncRoute(async (req, res) => {
  const result = await people.listEmployees(req.auth!, req.query as Record<string, unknown>);
  res.json(ok(result.rows, result.meta));
}));
api.post("/employees", requireAuth, requirePermission("employees.create"), validate(wrap(employeeBody)), asyncRoute(async (req, res) => {
  const { body } = readInput(req, wrap(employeeBody));
  res.status(201).json(ok(await people.createEmployee(req.auth!, body)));
}));
api.get("/employees/:id", requireAuth, asyncRoute(async (req, res) => res.json(ok(await people.getEmployee(req.auth!, req.params.id)))));
api.patch("/employees/:id", requireAuth, validate(z.object({ body: z.object(employeeBody).partial(), query: z.object({}).passthrough(), params: z.object({}).passthrough() })), asyncRoute(async (req, res) => {
  const schema = z.object({ body: z.object(employeeBody).partial(), query: z.object({}).passthrough(), params: z.object({}).passthrough() });
  const { body } = readInput(req, schema);
  res.json(ok(await people.updateEmployee(req.auth!, req.params.id, body)));
}));
api.get("/teams", requireAuth, requireAnyPermission("employees.view", "projects.view"), asyncRoute(async (_req, res) => res.json(ok(await people.listTeams()))));
api.post("/teams", requireAuth, requirePermission("employees.edit"), validate(wrap({ name: z.string().min(2), leadEmployeeId: z.string().optional() })), asyncRoute(async (req, res) => {
  const { body } = readInput(req, wrap({ name: z.string().min(2), leadEmployeeId: z.string().optional() }));
  res.status(201).json(ok(await people.saveTeam(body)));
}));
api.get("/shifts", requireAuth, requireAnyPermission("attendance.view", "attendance.self", "attendance.manage"), asyncRoute(async (_req, res) => res.json(ok(await people.listShifts()))));
const shiftBody = { name: z.string().trim().min(2).max(40), startTime: z.string(), endTime: z.string(), graceMinutes: z.number().int().min(0).max(180).optional(), workingDays: z.array(z.number().int()).optional() };
api.post("/shifts", requireAuth, requirePermission("attendance.manage"), validate(wrap(shiftBody)), asyncRoute(async (req, res) => {
  const { body } = readInput(req, wrap(shiftBody));
  res.status(201).json(ok(await people.saveShift(req.auth!, body)));
}));
api.patch("/shifts/:id", requireAuth, validate(z.object({ body: z.object(shiftBody).partial(), query: z.object({}).passthrough(), params: z.object({ id: z.string() }) })), asyncRoute(async (req, res) => {
  const schema = z.object({ body: z.object(shiftBody).partial(), query: z.object({}).passthrough(), params: z.object({ id: z.string() }) });
  const { body } = readInput(req, schema);
  const current = await people.listShifts();
  const shift = current.find((item: { _id: unknown }) => String(item._id) === req.params.id);
  if (!shift) throw new AppError(404, "NOT_FOUND", "Shift not found.");
  res.json(ok(await people.saveShift(req.auth!, {
    name: body.name || shift.name,
    startTime: body.startTime || shift.startTime,
    endTime: body.endTime || shift.endTime,
    graceMinutes: body.graceMinutes ?? shift.graceMinutes,
    workingDays: body.workingDays ?? shift.workingDays,
  }, req.params.id)));
}));
api.get("/holidays", requireAuth, requireAnyPermission("attendance.view", "attendance.self"), asyncRoute(async (_req, res) => res.json(ok(await people.listHolidays()))));
api.post("/holidays", requireAuth, requirePermission("attendance.manage"), validate(wrap({ dateKey: z.string(), name: z.string().min(2) })), asyncRoute(async (req, res) => {
  const { body } = readInput(req, wrap({ dateKey: z.string(), name: z.string().min(2) }));
  res.status(201).json(ok(await people.saveHoliday(body.dateKey, body.name)));
}));
api.post("/attendance/kiosk-token", requireAuth, requirePermission("attendance.manage"), asyncRoute(async (req, res) => res.json(ok(await people.createKioskToken(req.auth!)))));
api.post("/attendance/screen-link", requireAuth, asyncRoute(async (req, res) => res.json(ok(await people.issueOfficeScreen(req.auth!)))));
api.get("/attendance/screen", asyncRoute(async (req, res) => res.json(ok(await people.officeScreenCode(typeof req.query.key === "string" ? req.query.key : "")))));
api.post("/attendance/check-in", requireAuth, requirePermission("attendance.self"), validate(wrap({ code: z.string().min(4) })), asyncRoute(async (req, res) => {
  const { body } = readInput(req, wrap({ code: z.string().min(4) }));
  res.json(ok(await people.checkIn(req.auth!, body.code)));
}));
api.post("/attendance/check-out", requireAuth, requirePermission("attendance.self"), validate(wrap({ code: z.string().min(4) })), asyncRoute(async (req, res) => {
  const { body } = readInput(req, wrap({ code: z.string().min(4) }));
  res.json(ok(await people.checkOut(req.auth!, body.code)));
}));
const punchBody = wrap({ code: z.string().min(4), latitude: z.number().finite(), longitude: z.number().finite(), accuracy: z.number().finite() });
api.post("/attendance/punch-in", requireAuth, requirePermission("attendance.self"), validate(punchBody), asyncRoute(async (req, res) => {
  const { body } = readInput(req, punchBody);
  res.json(ok(await people.punchIn(req.auth!, body)));
}));
api.post("/attendance/punch-out", requireAuth, requirePermission("attendance.self"), validate(punchBody), asyncRoute(async (req, res) => {
  const { body } = readInput(req, punchBody);
  res.json(ok(await people.punchOut(req.auth!, body)));
}));
api.post("/attendance/exceptions", requireAuth, requirePermission("attendance.self"), validate(wrap({ dateKey: z.string(), kind: z.enum(["qr_failed", "location_failed", "missed_punch"]), reason: z.string().min(2), checkInTime: z.string().optional(), checkOutTime: z.string().optional() })), asyncRoute(async (req, res) => {
  const schema = wrap({ dateKey: z.string(), kind: z.enum(["qr_failed", "location_failed", "missed_punch"]), reason: z.string().min(2), checkInTime: z.string().optional(), checkOutTime: z.string().optional() });
  const { body } = readInput(req, schema);
  res.status(201).json(ok(await people.requestPunchException(req.auth!, body)));
}));
api.get("/attendance/exceptions", requireAuth, requireAnyPermission("attendance.self", "attendance.correct", "attendance.manage"), asyncRoute(async (req, res) => res.json(ok(await people.listPunchExceptions(req.auth!)))));
api.post("/attendance/exceptions/:id/decision", requireAuth, requirePermission("attendance.correct"), validate(wrap({ status: z.enum(["approved", "rejected"]), decisionNote: z.string().min(2) })), asyncRoute(async (req, res) => {
  const schema = wrap({ status: z.enum(["approved", "rejected"]), decisionNote: z.string().min(2) });
  const { body } = readInput(req, schema);
  res.json(ok(await people.decidePunchException(req.auth!, req.params.id, body)));
}));
api.get("/attendance", requireAuth, requireAnyPermission("attendance.view", "attendance.self"), asyncRoute(async (req, res) => res.json(ok(await people.listAttendance(req.auth!, req.query as Record<string, unknown>)))));
api.post("/attendance/corrections", requireAuth, requirePermission("attendance.correct"), validate(wrap({ employeeId: z.string(), dateKey: z.string(), checkInAt: z.string().optional(), checkOutAt: z.string().optional(), checkInTime: z.string().optional(), checkOutTime: z.string().optional(), reason: z.string().min(2) })), asyncRoute(async (req, res) => {
  const schema = wrap({ employeeId: z.string(), dateKey: z.string(), checkInAt: z.string().optional(), checkOutAt: z.string().optional(), checkInTime: z.string().optional(), checkOutTime: z.string().optional(), reason: z.string().min(2) });
  const { body } = readInput(req, schema);
  res.json(ok(await people.correctAttendance(req.auth!, body)));
}));
api.get("/leave", requireAuth, requireAnyPermission("attendance.view", "attendance.self", "attendance.manage"), asyncRoute(async (req, res) => res.json(ok(await people.listLeave(req.auth!, req.query as Record<string, unknown>)))));
api.post("/leave", requireAuth, requirePermission("attendance.self"), validate(wrap({ type: z.enum(["paid", "sick", "unpaid"]), fromKey: z.string(), toKey: z.string(), reason: z.string().min(2) })), asyncRoute(async (req, res) => {
  const schema = wrap({ type: z.enum(["paid", "sick", "unpaid"]), fromKey: z.string(), toKey: z.string(), reason: z.string().min(2) });
  const { body } = readInput(req, schema);
  res.status(201).json(ok(await people.requestLeave(req.auth!, body)));
}));
api.post("/leave/:id/decision", requireAuth, requirePermission("attendance.manage"), validate(wrap({ status: z.enum(["approved", "rejected"]), decisionNote: z.string().optional() })), asyncRoute(async (req, res) => {
  const schema = wrap({ status: z.enum(["approved", "rejected"]), decisionNote: z.string().optional() });
  const { body } = readInput(req, schema);
  res.json(ok(await people.decideLeave(req.auth!, req.params.id, body.status, body.decisionNote)));
}));
api.get("/overtime", requireAuth, requireAnyPermission("attendance.self", "attendance.manage", "payroll.manage"), asyncRoute(async (req, res) => res.json(ok(await people.listOvertime(req.auth!)))));
api.post("/overtime", requireAuth, requirePermission("attendance.self"), validate(wrap({ dateKey: z.string(), minutes: z.number().int().positive(), reason: z.string().min(2) })), asyncRoute(async (req, res) => {
  const schema = wrap({ dateKey: z.string(), minutes: z.number().int().positive(), reason: z.string().min(2) });
  const { body } = readInput(req, schema);
  res.status(201).json(ok(await people.requestOvertime(req.auth!, body)));
}));
api.post("/overtime/:id/decision", requireAuth, requirePermission("attendance.manage"), validate(wrap({ status: z.enum(["approved", "rejected"]) })), asyncRoute(async (req, res) => {
  const { body } = readInput(req, wrap({ status: z.enum(["approved", "rejected"]) }));
  res.json(ok(await people.decideOvertime(req.auth!, req.params.id, body.status)));
}));
api.post("/payroll/preview", requireAuth, requirePermission("payroll.manage"), validate(wrap({ monthKey: z.string() })), asyncRoute(async (req, res) => {
  const { body } = readInput(req, wrap({ monthKey: z.string() }));
  res.json(ok(await people.generatePayroll(req.auth!, body.monthKey)));
}));
api.get("/payroll/:monthKey", requireAuth, requirePermission("payroll.view"), asyncRoute(async (req, res) => res.json(ok(await people.getPayroll(req.auth!, req.params.monthKey)))));
api.post("/payroll/:monthKey/finalize", requireAuth, requirePermission("payroll.approve"), validate(wrap({ statutoryAcknowledged: z.boolean() })), asyncRoute(async (req, res) => {
  const { body } = readInput(req, wrap({ statutoryAcknowledged: z.boolean() }));
  res.json(ok(await people.finalizePayroll(req.auth!, req.params.monthKey, body.statutoryAcknowledged)));
}));
api.post("/payroll/:monthKey/adjustments", requireAuth, requirePermission("payroll.approve"), validate(wrap({ employeeId: z.string(), amountPaise: z.number().int(), reason: z.string().min(2) })), asyncRoute(async (req, res) => {
  const schema = wrap({ employeeId: z.string(), amountPaise: z.number().int(), reason: z.string().min(2) });
  const { body } = readInput(req, schema);
  res.status(201).json(ok(await people.adjustPayroll(req.auth!, req.params.monthKey, body)));
}));
api.get("/payroll/me/slips", requireAuth, asyncRoute(async (req, res) => res.json(ok(await people.myPayslips(req.auth!)))));

api.get("/dashboard", requireAuth, requirePermission("dashboard.view"), asyncRoute(async (req, res) => {
  const from = typeof req.query.from === "string" ? req.query.from : new Date().toISOString().slice(0, 8) + "01";
  const to = typeof req.query.to === "string" ? req.query.to : new Date().toISOString().slice(0, 10);
  res.json(ok(await insights.dashboard(req.auth!, from, to)));
}));
api.get("/analytics/financial", requireAuth, requirePermission("analytics.financial"), asyncRoute(async (req, res) => {
  res.json(ok(await insights.financialReport(req.auth!, String(req.query.from), String(req.query.to))));
}));
api.get("/analytics/production", requireAuth, requireAnyPermission("analytics.view", "analytics.financial"), asyncRoute(async (req, res) => {
  res.json(ok(await insights.productionReport(req.auth!, String(req.query.from), String(req.query.to))));
}));
api.get("/analytics/performance", requireAuth, requirePermission("analytics.view"), asyncRoute(async (req, res) => {
  res.json(ok(await insights.performanceReport(req.auth!, String(req.query.from), String(req.query.to))));
}));
api.get("/work", requireAuth, asyncRoute(async (req, res) => {
  const span = req.query.span === "week" || req.query.span === "month" ? req.query.span : "day";
  res.json(ok(await workReport(req.auth!, { span, date: typeof req.query.date === "string" ? req.query.date : "", person: typeof req.query.person === "string" ? req.query.person : "" })));
}));
api.get("/search", requireAuth, requirePermission("search.view"), asyncRoute(async (req, res) => res.json(ok(await insights.searchRecords(req.auth!, String(req.query.q ?? ""))))));
api.get("/notifications", requireAuth, asyncRoute(async (req, res) => res.json(ok(await insights.listNotifications(req.auth!)))));
api.post("/notifications/:id/read", requireAuth, asyncRoute(async (req, res) => {
  await insights.markNotification(req.auth!, req.params.id);
  res.json(ok({ read: true }));
}));
api.post("/notifications/read-all", requireAuth, asyncRoute(async (req, res) => {
  await insights.markAllNotifications(req.auth!);
  res.json(ok({ read: true }));
}));
api.get("/audit", requireAuth, requirePermission("audit.view"), asyncRoute(async (req, res) => res.json(ok(await insights.listAudit(req.query as Record<string, unknown>)))));
api.post("/dev/seed", requireAuth, asyncRoute(async (req, res) => {
  if (env.nodeEnv === "production") throw new AppError(404, "NOT_FOUND", "Not found.");
  if (!req.auth?.isSuperAdmin) throw new AppError(403, "FORBIDDEN", "Only a super admin can load the demo studio.");
  await seedDemo();
  res.json(ok({ seeded: true }));
}));
api.get("/maps/key", requireAuth, asyncRoute(async (req, res) => {
  if (!req.auth?.isSuperAdmin) throw new AppError(403, "FORBIDDEN", "Only a super admin can open the office map.");
  if (!env.googleMapsApiKey) throw new AppError(409, "CONFLICT", "Add a Google Maps API key to show the streets.");
  res.json(ok({ key: env.googleMapsApiKey }));
}));
api.get("/settings", requireAuth, requirePermission("settings.manage"), asyncRoute(async (_req, res) => {
  const settings = await getSettings();
  res.json(ok({ ...settings.toObject(), phoneHosts: phoneApiHosts(env.port) }));
}));
api.put("/settings", requireAuth, requirePermission("settings.manage"), asyncRoute(async (req, res) => res.json(ok(await insights.updateSettings(req.auth!, req.body)))));
api.post("/studio/wipe", requireAuth, validate(wrap({ confirm: z.literal("DELETE") })), asyncRoute(async (req, res) => {
  res.json(ok(await wipeStudio(req.auth!)));
}));

api.get("/exports/invoices.csv", requireAuth, requirePermission("exports.create"), requirePermission("invoices.view"), asyncRoute(async (req, res) => {
  const rows = await Invoice.find(req.auth!.isSuperAdmin ? {} : {}).select("invoiceNumber status totalPaise paidPaise issueDate").lean() as any;
  const csv = toCsv([["Number", "Status", "Total paise", "Paid paise", "Issued"], ...rows.map((row) => [row.invoiceNumber, row.status, row.totalPaise, row.paidPaise, row.issueDate?.toISOString() ?? ""])]);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.send(csv);
}));
api.get("/exports/attendance.csv", requireAuth, requirePermission("exports.create"), requirePermission("attendance.view"), asyncRoute(async (_req, res) => {
  const rows = await Attendance.find().limit(1000).lean() as any;
  const employees = await Employee.find().select("firstName lastName employeeCode").lean() as any;
  const names = new Map(employees.map((employee) => [String(employee._id), `${employee.employeeCode} ${employee.firstName} ${employee.lastName}`]));
  const csv = toCsv([["Employee", "Date", "Check in", "Check out", "Minutes", "Late"], ...rows.map((row) => [names.get(String(row.employeeId)) ?? "", row.dateKey, row.checkInAt?.toISOString() ?? "", row.checkOutAt?.toISOString() ?? "", row.minutes, row.late ? "yes" : "no"])]);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.send(csv);
}));

const assetBody = {
  name: z.string().trim().min(2).max(80),
  category: z.enum(["camera", "lens", "lighting", "audio", "drone", "grip", "computer", "storage", "power", "vehicle", "other"]),
  brand: z.string().trim().max(80).optional(),
  modelName: z.string().trim().max(80).optional(),
  serialNumber: z.string().trim().max(80).optional(),
  condition: z.enum(["new", "good", "fair", "poor"]),
  location: z.string().trim().max(120).optional(),
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  purchasePaise: z.number().int().nonnegative().max(100_000_000_00).optional(),
  vendor: z.string().trim().max(80).optional(),
  warrantyUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional(),
};
api.get("/assets", requireAuth, asyncRoute(async (req, res) => res.json(ok(await assets.listAssets(req.auth!, req.query as Record<string, unknown>)))));
api.post("/assets", requireAuth, validate(wrap(assetBody)), asyncRoute(async (req, res) => {
  const { body } = readInput(req, wrap(assetBody));
  res.status(201).json(ok(await assets.createAsset(req.auth!, body)));
}));
api.get("/assets/:id", requireAuth, asyncRoute(async (req, res) => res.json(ok(await assets.getAsset(req.auth!, req.params.id)))));
api.patch("/assets/:id", requireAuth, validate(wrap(assetBody)), asyncRoute(async (req, res) => {
  const { body } = readInput(req, wrap(assetBody));
  res.json(ok(await assets.updateAsset(req.auth!, req.params.id, body)));
}));
api.post("/assets/:id/events", requireAuth, validate(wrap({ kind: z.enum(["assigned", "returned", "damaged", "repair_sent", "repair_done", "service", "retired", "lost", "note"]), dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().trim().max(500).optional(), costPaise: z.number().int().nonnegative().max(100_000_000_00).optional(), holderEmployeeId: z.string().optional(), condition: z.enum(["new", "good", "fair", "poor"]).optional() })), asyncRoute(async (req, res) => {
  const schema = wrap({ kind: z.enum(["assigned", "returned", "damaged", "repair_sent", "repair_done", "service", "retired", "lost", "note"]), dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().trim().max(500).optional(), costPaise: z.number().int().nonnegative().max(100_000_000_00).optional(), holderEmployeeId: z.string().optional(), condition: z.enum(["new", "good", "fair", "poor"]).optional() });
  const { body } = readInput(req, schema);
  res.json(ok(await assets.recordAssetEvent(req.auth!, req.params.id, body)));
}));

api.post("/media/intent", requireAuth, validate(wrap({ filename: z.string().min(1), contentType: z.string().min(3), size: z.number().int().positive(), ownerType: z.string().min(2), ownerId: z.string().optional(), kind: z.string().optional() })), asyncRoute(async (req, res) => {
  const schema = wrap({ filename: z.string().min(1), contentType: z.string().min(3), size: z.number().int().positive(), ownerType: z.string().min(2), ownerId: z.string().optional(), kind: z.string().optional() });
  const { body } = readInput(req, schema);
  res.status(201).json(ok(await storage.createUploadIntent(req.auth!, body)));
}));
api.post("/media/:id/content", requireAuth, express.raw({ type: "*/*", limit: "80mb" }), asyncRoute(async (req, res) => {
  const body = req.body as Buffer;
  res.json(ok(await storage.saveLocalUpload(req.params.id, body, req.header("content-type") || "application/octet-stream")));
}));
api.get("/media/:id/access", requireAuth, asyncRoute(async (req, res) => res.json(ok(await storage.accessUrl(req.auth!, req.params.id)))));
api.get("/media/:id/file", requireAuth, asyncRoute(async (req, res) => {
  const access = await storage.accessUrl(req.auth!, req.params.id);
  if (access.url.startsWith("http")) {
    res.redirect(access.url);
    return;
  }
  const { MediaAsset } = await import("./models");
  const asset = await MediaAsset.findById(req.params.id);
  if (!asset) return res.status(404).end();
  const { full } = resolveLocalPath(asset.storageKey);
  res.setHeader("Content-Type", asset.contentType);
  fs.createReadStream(full).pipe(res);
}));

