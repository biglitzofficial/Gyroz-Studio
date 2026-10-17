import { z } from "zod";
import { env } from "../config";
import { AppError } from "../http";
import { Role, Settings, User } from "../models";
import { allPermissionKeys, roleTemplates, type PermissionKey } from "../domain/permissions";
import {
  assertLoginRate,
  clearRefreshCookie,
  hashPassword,
  hashToken,
  issueSession,
  loadAuth,
  newRefreshToken,
  publicUser,
  setRefreshCookie,
  signAccessToken,
  verifyPassword,
  type AuthContext,
} from "../auth";
import { audit } from "../platform";
import type { Response } from "express";

const passwordSchema = z.string().min(8).regex(/[A-Za-z]/, "Include a letter").regex(/[0-9]/, "Include a number");

export const loginSchema = z.object({
  body: z.object({ email: z.string().email(), password: z.string().min(1) }),
  query: z.object({}).passthrough(),
  params: z.object({}).passthrough(),
});

export const passwordChangeSchema = z.object({
  body: z.object({ currentPassword: z.string().min(1), nextPassword: passwordSchema }),
  query: z.object({}).passthrough(),
  params: z.object({}).passthrough(),
});

export const profileSchema = z.object({
  body: z.object({ name: z.string().min(2).max(80) }),
  query: z.object({}).passthrough(),
  params: z.object({}).passthrough(),
});

export async function bootstrap() {
  for (const template of roleTemplates()) {
    if (template.systemKey === "super_admin" || template.systemKey === "admin") {
      await Role.updateOne(
        { systemKey: template.systemKey },
        {
          $set: { permissions: allPermissionKeys(), name: template.name, description: template.description, protected: true },
          $setOnInsert: { slug: template.slug, systemKey: template.systemKey },
        },
        { upsert: true },
      );
      continue;
    }
    await Role.updateOne(
      { slug: template.slug },
      {
        $setOnInsert: {
          name: template.name,
          slug: template.slug,
          systemKey: template.systemKey,
          description: template.description,
          permissions: template.permissions,
          protected: template.protected,
        },
      },
      { upsert: true },
    );
  }

  const superRole = await Role.findOne({ systemKey: "super_admin" });
  if (!superRole) throw new Error("Super admin role was not created.");
  const account = await User.findOne({ email: env.bootstrapEmail });
  if (!account) {
    const holders = await User.find({ roleId: String(superRole._id) });
    const previous = holders.find((user) => user.email === "director@gyroz.studio");
    if (previous && holders.length === 1) {
      previous.email = env.bootstrapEmail;
      previous.name = env.bootstrapName;
      previous.passwordHash = await hashPassword(env.bootstrapPassword);
      previous.mustChangePassword = false;
      await previous.save();
    } else if (!holders.length) {
      await User.create({
        email: env.bootstrapEmail,
        name: env.bootstrapName,
        passwordHash: await hashPassword(env.bootstrapPassword),
        roleId: superRole._id,
        status: "active",
        mustChangePassword: false,
      });
    }
  }

  const settings = await Settings.findOne({ key: "studio" });
  if (!settings) {
    await Settings.create({
      key: "studio",
      legalName: "Gyroz Studio",
      businessTimezone: env.businessTimezone,
      currency: env.currency,
      payroll: { defaultDailyRatePaise: 50_000, standardPayableDays: 26, salaryDay: 5 },
    });
  }
}

export async function login(email: string, password: string, ip: string, res: Response) {
  assertLoginRate(ip);
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user || user.status !== "active" || !(await verifyPassword(password, user.passwordHash))) {
    throw new AppError(401, "UNAUTHORIZED", "Email or password is incorrect.");
  }
  const session = await issueSession(String(user._id), user.tokenVersion);
  setRefreshCookie(res, session.refreshToken);
  return { accessToken: session.accessToken, refreshToken: session.refreshToken, user: await publicUser(String(user._id)) };
}

export async function refresh(token: string | undefined, res: Response) {
  if (!token) throw new AppError(401, "UNAUTHORIZED", "Sign in required.");
  const hash = hashToken(token);
  const user = await User.findOne({ "refreshTokens.hash": hash, status: "active" });
  const stored = user?.refreshTokens.find((item: { hash: string; expiresAt: Date }) => item.hash === hash);
  const expiresAt = stored?.expiresAt instanceof Date ? stored.expiresAt.getTime() : new Date(stored?.expiresAt ?? 0).getTime();
  if (!user || !stored || !Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    throw new AppError(401, "UNAUTHORIZED", "Session expired. Sign in again.");
  }
  await User.updateOne({ _id: user._id }, { $pull: { refreshTokens: { hash } } });
  const session = await issueSession(String(user._id), user.tokenVersion);
  setRefreshCookie(res, session.refreshToken);
  return { accessToken: session.accessToken, refreshToken: session.refreshToken, user: await publicUser(String(user._id)) };
}

export async function logout(token: string | undefined, res: Response) {
  if (token) {
    await User.updateOne({ "refreshTokens.hash": hashToken(token) }, { $pull: { refreshTokens: { hash: hashToken(token) } } });
  }
  clearRefreshCookie(res);
}

export async function changePassword(auth: AuthContext, currentPassword: string, nextPassword: string) {
  const user = await User.findById(auth.userId);
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new AppError(400, "VALIDATION", "Current password is incorrect.");
  }
  user.passwordHash = await hashPassword(nextPassword);
  user.mustChangePassword = false;
  user.tokenVersion += 1;
  user.refreshTokens = [];
  await user.save();
  await audit({ actorId: auth.userId, action: "password.changed", entityType: "user", entityId: auth.userId });
  const session = await issueSession(auth.userId, user.tokenVersion);
  return { accessToken: session.accessToken, refreshToken: session.refreshToken, user: await publicUser(auth.userId) };
}

export async function updateProfile(auth: AuthContext, name: string) {
  await User.updateOne({ _id: auth.userId }, { name });
  return publicUser(auth.userId);
}

export async function listRoles() {
  const roles = await Role.find().sort({ protected: -1, name: 1 }).lean() as any;
  return roles.map((role) => ({
    id: String(role._id),
    name: role.name,
    slug: role.slug,
    systemKey: role.systemKey,
    description: role.description,
    permissions: role.permissions,
    protected: role.protected,
  }));
}

export async function saveRole(auth: AuthContext, input: { id?: string; name: string; description?: string; permissions: string[] }, existingId?: string) {
  if (!auth.isSuperAdmin) throw new AppError(403, "FORBIDDEN", "Only a super admin can change roles.");
  const permissions = [...new Set(input.permissions)];
  const known = new Set(allPermissionKeys());
  if (permissions.some((key) => !known.has(key as PermissionKey))) {
    throw new AppError(400, "VALIDATION", "Unknown permission.");
  }
  if (existingId) {
    const role = await Role.findById(existingId);
    if (!role) throw new AppError(404, "NOT_FOUND", "Role not found.");
    if (role.systemKey === "super_admin" || role.systemKey === "admin") throw new AppError(403, "FORBIDDEN", "This role always has full access and cannot be modified.");
    const before = { name: role.name, permissions: role.permissions };
    role.name = input.name;
    role.description = input.description ?? role.description;
    role.permissions = permissions;
    await role.save();
    await audit({ actorId: auth.userId, action: "role.updated", entityType: "role", entityId: String(role._id), before, after: { name: role.name, permissions: role.permissions } });
    return listRoles();
  }
  const slug = input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  if (!slug || slug === "super-admin" || slug === "admin") throw new AppError(409, "CONFLICT", "That name is reserved for a system role.");
  if (permissions.includes("roles.manage")) throw new AppError(403, "FORBIDDEN", "A new role cannot manage roles. Only the super admin can.");
  const taken = await Role.findOne({ slug });
  if (taken) throw new AppError(409, "CONFLICT", "A role with that name already exists.");
  const role = await Role.create({ name: input.name.trim(), slug, description: input.description?.trim() ?? "", permissions, systemKey: null, protected: false });
  await audit({ actorId: auth.userId, action: "role.created", entityType: "role", entityId: String(role._id), after: { name: role.name, permissions } });
  return listRoles();
}

export async function updateUserAccess(auth: AuthContext, userId: string, input: { roleId?: string; status?: "active" | "disabled"; scopeClientIds?: string[]; scopeProjectIds?: string[] }) {
  if (!auth.isSuperAdmin) throw new AppError(403, "FORBIDDEN", "Only a super admin can change access.");
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, "NOT_FOUND", "User not found.");
  if (input.roleId) {
    const role = await Role.findById(input.roleId);
    if (!role) throw new AppError(400, "VALIDATION", "Role not found.");
    if (role.systemKey === "super_admin" && String(user._id) !== auth.userId) {
      const superCount = await User.countDocuments({ roleId: role._id, status: "active" });
      if (superCount >= 1 && String(user.roleId) !== String(role._id)) {
        const actor = await loadAuth(auth.userId);
        if (!actor.isSuperAdmin) throw new AppError(403, "FORBIDDEN", "Super admin access cannot be granted this way.");
      }
    }
    const current = await Role.findById(user.roleId);
    if (current?.systemKey === "super_admin" && role.systemKey !== "super_admin") {
      const remaining = await User.countDocuments({ roleId: current._id, status: "active", _id: { $ne: user._id } });
      if (remaining < 1) throw new AppError(409, "CONFLICT", "The studio needs at least one active super admin.");
    }
    user.roleId = role._id;
  }
  if (input.status) {
    if (String(user._id) === auth.userId && input.status === "disabled") {
      throw new AppError(409, "CONFLICT", "You cannot disable your own account.");
    }
    user.status = input.status;
  }
  if (input.scopeClientIds) user.scopeClientIds = input.scopeClientIds as unknown as typeof user.scopeClientIds;
  if (input.scopeProjectIds) user.scopeProjectIds = input.scopeProjectIds as unknown as typeof user.scopeProjectIds;
  user.tokenVersion += 1;
  await user.save();
  await audit({ actorId: auth.userId, action: "user.access_updated", entityType: "user", entityId: String(user._id), after: { roleId: user.roleId, status: user.status, scopeClientIds: user.scopeClientIds, scopeProjectIds: user.scopeProjectIds } });
  return publicUser(String(user._id));
}

export { newRefreshToken, signAccessToken };
