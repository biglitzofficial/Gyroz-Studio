import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodType } from "zod";

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function ok<T>(data: T, meta?: Record<string, unknown>) {
  return meta ? { success: true as const, data, meta } : { success: true as const, data };
}

export function asyncRoute(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function validate<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.safeParse({ body: req.body ?? {}, query: req.query ?? {}, params: req.params ?? {} });
    if (!parsed.success) {
      next(new AppError(400, "VALIDATION", "Check the form and try again.", parsed.error.flatten()));
      return;
    }
    req.input = parsed.data;
    next();
  };
}

export function readInput<T>(req: Request, schema: ZodType<T>): T {
  return schema.parse(req.input);
}

export function pageParams(query: { page?: unknown; limit?: unknown }) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

export function sortSpec(sort: unknown, allowed: string[], fallback: string): Record<string, 1 | -1> {
  const raw = typeof sort === "string" && sort ? sort : fallback;
  const descending = raw.startsWith("-");
  const field = descending ? raw.slice(1) : raw;
  const safe = allowed.includes(field) ? field : fallback.replace(/^-/, "");
  const direction: 1 | -1 = (allowed.includes(field) ? descending : fallback.startsWith("-")) ? -1 : 1;
  return { [safe]: direction };
}

export function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function oid(value: string) {
  return /^[a-f\d]{24}$/i.test(value);
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof AppError) {
    res.status(error.status).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.status === 400 ? error.details : undefined,
      },
    });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({ success: false, error: { code: "VALIDATION", message: "Check the form and try again.", details: error.flatten() } });
    return;
  }
  if (error && typeof error === "object" && "code" in error && (error as { code?: number }).code === 11000) {
    res.status(409).json({ success: false, error: { code: "CONFLICT", message: "That record already exists." } });
    return;
  }
  if (error && typeof error === "object" && "name" in error && (error as { name?: string }).name === "CastError") {
    res.status(400).json({ success: false, error: { code: "VALIDATION", message: "A referenced record was not valid." } });
    return;
  }
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (message.startsWith("A project cannot move")) {
    res.status(409).json({ success: false, error: { code: "INVALID_TRANSITION", message } });
    return;
  }
  res.status(500).json({ success: false, error: { code: "INTERNAL", message: "Something went wrong. The studio team has a log of this request." } });
}
