import os from "node:os";
import { hasPermission, type AuthContext } from "./auth";
import { AppError } from "./http";
import { Activity, AuditLog, Counter, Notification, Role, Settings, User } from "./models";

const SECRET_KEYS = ["passwordHash", "refreshTokens", "codeHash", "accessToken", "refreshToken"];

export function sanitize(value: unknown): unknown {
  if (!value || typeof value !== "object") return value ?? null;
  const json = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  for (const key of Object.keys(json)) {
    if (SECRET_KEYS.includes(key) || key.toLowerCase().includes("password")) delete json[key];
  }
  return json;
}

export async function audit(entry: {
  actorId?: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}) {
  await AuditLog.create({
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: sanitize(entry.before),
    after: sanitize(entry.after),
  });
}

export async function activity(entry: {
  clientId?: unknown;
  projectId?: unknown;
  deliverableId?: unknown;
  actorId?: string;
  verb: string;
  summary: string;
}) {
  await Activity.create(entry);
}

export async function notify(userIds: Array<string | undefined>, payload: {
  type: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
}) {
  const unique = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return;
  await Notification.insertMany(unique.map((userId) => ({ userId, ...payload, readAt: null })));
}

export async function userIdsForSystemKey(systemKey: "admin" | "super_admin") {
  const roles = await Role.find({ systemKey }).select("_id").lean() as Array<{ _id: unknown }>;
  const users = await User.find({ status: "active", roleId: { $in: roles.map((role) => role._id) } }).select("_id").lean() as Array<{ _id: unknown }>;
  return users.map((user) => String(user._id));
}

export async function recipientIds(permission: string, clientId?: string) {
  const roles = await Role.find({ $or: [{ systemKey: "super_admin" }, { permissions: permission }] }).select("_id systemKey").lean() as any;
  const users = await User.find({ status: "active", roleId: { $in: roles.map((role) => role._id) } }).select("_id roleId scopeClientIds").lean() as any;
  return users
    .filter((user) => {
      const role = roles.find((item) => String(item._id) === String(user.roleId));
      if (role?.systemKey === "super_admin") return true;
      if (!clientId || !user.scopeClientIds?.length) return true;
      return user.scopeClientIds.some((id: unknown) => String(id) === clientId);
    })
    .map((user) => String(user._id));
}

export async function nextCode(key: string, prefix: string, session?: unknown) {
  const doc = await Counter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, session: session ?? undefined },
  );
  return `${prefix}-${String(doc?.seq ?? 1).padStart(4, "0")}`;
}

export async function nextEmployeeCode(year: number, session?: unknown) {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new AppError(400, "VALIDATION", "Employee code year is not valid.");
  const doc = await Counter.findOneAndUpdate(
    { key: `employee-${year}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, session: session ?? undefined },
  );
  return `${year}-GYROZ-${String(doc?.seq ?? 1).padStart(3, "0")}`;
}

export function phoneApiHosts(port: number) {
  const hosts = new Set<string>();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      const family = String(net.family);
      if (net.internal || (family !== "IPv4" && family !== "4")) continue;
      hosts.add(`http://${net.address}:${port}`);
    }
  }
  return [...hosts];
}

export async function getSettings() {
  const settings = await Settings.findOne({ key: "studio" });
  if (!settings) throw new AppError(500, "INTERNAL", "Studio settings have not been initialized.");
  return settings;
}

export async function studioTimezone() {
  const settings = await Settings.findOne({ key: "studio" }).lean() as any;
  return settings?.businessTimezone || "Asia/Kolkata";
}

export function assertPermission(auth: AuthContext, key: string) {
  if (!hasPermission(auth, key)) throw new AppError(403, "FORBIDDEN", "You do not have permission for this action.");
}

export function toCsv(rows: Array<Array<string | number | null | undefined>>) {
  const lines = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","));
  return `\uFEFF${lines.join("\n")}`;
}
