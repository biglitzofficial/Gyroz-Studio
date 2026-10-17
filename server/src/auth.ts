import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { env } from "./config";
import { AppError } from "./http";
import { Role, User } from "./models";

export type AuthContext = {
  userId: string;
  employeeId?: string;
  email: string;
  name: string;
  roleId: string;
  roleName: string;
  roleSlug: string;
  systemKey: "super_admin" | "admin" | null;
  permissions: string[];
  isSuperAdmin: boolean;
  scopeClientIds: string[];
  scopeProjectIds: string[];
  mustChangePassword: boolean;
};

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

export function assertLoginRate(ip: string) {
  const now = Date.now();
  const current = loginAttempts.get(ip);
  if (!current || current.resetAt < now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return;
  }
  current.count += 1;
  if (current.count > 12) {
    throw new AppError(429, "RATE_LIMITED", "Too many sign-in attempts. Wait a few minutes and try again.");
  }
}

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function newRefreshToken() {
  return crypto.randomBytes(48).toString("hex");
}

export async function publicUser(userId: string) {
  const auth = await loadAuth(userId);
  return {
    id: auth.userId,
    email: auth.email,
    name: auth.name,
    employeeId: auth.employeeId ?? null,
    mustChangePassword: auth.mustChangePassword,
    role: {
      id: auth.roleId,
      name: auth.roleName,
      slug: auth.roleSlug,
      systemKey: auth.systemKey,
      permissions: auth.permissions,
    },
    scopeClientIds: auth.scopeClientIds,
    scopeProjectIds: auth.scopeProjectIds,
  };
}

export async function loadAuth(userId: string): Promise<AuthContext> {
  const user = await User.findById(userId);
  if (!user || user.status !== "active") throw new AppError(401, "UNAUTHORIZED", "Sign in required.");
  const role = await Role.findById(user.roleId);
  if (!role) throw new AppError(401, "UNAUTHORIZED", "This account has no role.");
  const systemKey = (role.systemKey ?? null) as AuthContext["systemKey"];
  return {
    userId: String(user._id),
    employeeId: user.employeeId ? String(user.employeeId) : undefined,
    email: user.email,
    name: user.name,
    roleId: String(role._id),
    roleName: role.name,
    roleSlug: role.slug,
    systemKey,
    permissions: role.permissions,
    isSuperAdmin: systemKey === "super_admin" || systemKey === "admin",
    scopeClientIds: (user.scopeClientIds ?? []).map(String),
    scopeProjectIds: (user.scopeProjectIds ?? []).map(String),
    mustChangePassword: user.mustChangePassword,
  };
}

export function signAccessToken(userId: string, tokenVersion: number) {
  return jwt.sign({ sub: userId, tv: tokenVersion }, env.jwtAccessSecret, { expiresIn: env.accessTtlSeconds });
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, env.jwtAccessSecret) as { sub: string; tv: number };
}

export async function issueSession(userId: string, tokenVersion: number) {
  const refresh = newRefreshToken();
  const expiresAt = new Date(Date.now() + env.refreshTtlDays * 86400000);
  await User.updateOne({ _id: userId }, { $push: { refreshTokens: { hash: hashToken(refresh), expiresAt } } });
  return { accessToken: signAccessToken(userId, tokenVersion), refreshToken: refresh, expiresAt };
}

export function setRefreshCookie(res: Response, token: string) {
  res.cookie("gyroz_refresh", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.clientOrigin.startsWith("https://"),
    path: "/api/v1/auth",
    maxAge: env.refreshTtlDays * 86400000,
  });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie("gyroz_refresh", { path: "/api/v1/auth" });
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) throw new AppError(401, "UNAUTHORIZED", "Sign in required.");
    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub);
    if (!user || user.status !== "active" || user.tokenVersion !== payload.tv) {
      throw new AppError(401, "UNAUTHORIZED", "Session expired. Sign in again.");
    }
    req.auth = await loadAuth(String(user._id));
    const open = ["/auth/password", "/auth/logout", "/auth/me"].some((path) => req.path.endsWith(path));
    if (req.auth.mustChangePassword && !open) {
      throw new AppError(403, "PASSWORD_CHANGE_REQUIRED", "Change the temporary password before continuing.");
    }
    next();
  } catch (error) {
    if (error instanceof AppError) next(error);
    else next(new AppError(401, "UNAUTHORIZED", "Session expired. Sign in again."));
  }
}

export function requirePermission(...keys: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(new AppError(401, "UNAUTHORIZED", "Sign in required."));
    if (req.auth.isSuperAdmin || keys.every((key) => req.auth?.permissions.includes(key))) return next();
    return next(new AppError(403, "FORBIDDEN", "You do not have permission for this action."));
  };
}

export function requireAnyPermission(...keys: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(new AppError(401, "UNAUTHORIZED", "Sign in required."));
    if (req.auth.isSuperAdmin || keys.some((key) => req.auth?.permissions.includes(key))) return next();
    return next(new AppError(403, "FORBIDDEN", "You do not have permission for this action."));
  };
}

export function hasPermission(auth: AuthContext, key: string) {
  return auth.isSuperAdmin || auth.permissions.includes(key);
}

export function scopeFilter(auth: AuthContext, clientField = "clientId", projectField = "projectId") {
  const filter: Record<string, unknown> = {};
  if (auth.isSuperAdmin) return filter;
  if (auth.scopeClientIds.length) filter[clientField] = { $in: auth.scopeClientIds };
  if (auth.scopeProjectIds.length) filter[projectField] = { $in: auth.scopeProjectIds };
  return filter;
}

export function assertClientAccess(auth: AuthContext, clientId?: unknown, projectId?: unknown) {
  if (auth.isSuperAdmin) return;
  if (clientId && auth.scopeClientIds.length && !auth.scopeClientIds.includes(String(clientId))) {
    throw new AppError(403, "FORBIDDEN", "This client is outside your assignment.");
  }
  if (projectId && auth.scopeProjectIds.length && !auth.scopeProjectIds.includes(String(projectId))) {
    throw new AppError(403, "FORBIDDEN", "This project is outside your assignment.");
  }
}

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}
