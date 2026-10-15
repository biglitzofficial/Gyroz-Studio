import { MutationCache, type Mutation } from "@tanstack/react-query";
import { errorMessage } from "@/lib/api";

export type ToastTone = "success" | "danger";
export type ToastItem = { id: number; text: string; tone: ToastTone };

type Job = { id: number; label: string; until: number };
type Snapshot = { label: string | null; toasts: ToastItem[] };

let sequence = 0;
let jobs: Job[] = [];
let toasts: ToastItem[] = [];
let snapshot: Snapshot = { label: null, toasts: [] };
const listeners = new Set<() => void>();
const workIds = new WeakMap<Mutation<unknown, unknown, unknown, unknown>, number>();

function publish() {
  snapshot = { label: jobs.at(-1)?.label ?? null, toasts };
  listeners.forEach((listener) => listener());
}

export function subscribeFeedback(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function feedbackSnapshot() {
  return snapshot;
}

export function beginWork(label: string) {
  const id = ++sequence;
  jobs = [...jobs, { id, label, until: Date.now() + 420 }];
  publish();
  return id;
}

export function endWork(id: number) {
  const job = jobs.find((item) => item.id === id);
  const wait = job ? Math.max(0, job.until - Date.now()) : 0;
  window.setTimeout(() => {
    jobs = jobs.filter((item) => item.id !== id);
    publish();
  }, wait);
}

export function pushToast(text: string, tone: ToastTone = "success") {
  const trimmed = text.trim();
  if (!trimmed) return;
  const id = ++sequence;
  toasts = [...toasts, { id, text: trimmed, tone }].slice(-3);
  publish();
  window.setTimeout(() => dismissToast(id), tone === "danger" ? 6400 : 4200);
}

export function dismissToast(id: number) {
  if (!toasts.some((item) => item.id === id)) return;
  toasts = toasts.filter((item) => item.id !== id);
  publish();
}

function spoken(error: unknown) {
  if (error instanceof Error && !("isAxiosError" in error) && error.message) return error.message;
  return errorMessage(error);
}

function loadingLabel(meta: Record<string, unknown> | undefined, variables: unknown) {
  const value = meta?.loading;
  if (typeof value === "function") return String(value(variables) || "Saving");
  if (typeof value === "string" && value.trim()) return value;
  return "Saving";
}

function successLabel(meta: Record<string, unknown> | undefined, data: unknown, variables: unknown) {
  const value = meta?.toast;
  if (value === false) return null;
  if (typeof value === "function") {
    const text = value(data, variables);
    return typeof text === "string" && text.trim() ? text : null;
  }
  if (typeof value === "string") return value;
  return "Saved.";
}

export const mutationCache = new MutationCache({
  onMutate(variables, mutation) {
    if (mutation.options.meta?.silent) return;
    workIds.set(mutation, beginWork(loadingLabel(mutation.options.meta, variables)));
  },
  onSuccess(data, variables, _onMutateResult, mutation) {
    if (mutation.options.meta?.silent) return;
    const text = successLabel(mutation.options.meta, data, variables);
    if (text) pushToast(text);
  },
  onError(error, _variables, _onMutateResult, mutation) {
    if (mutation.options.meta?.silent) return;
    pushToast(spoken(error), "danger");
  },
  onSettled(_data, _error, _variables, _onMutateResult, mutation) {
    const id = workIds.get(mutation);
    if (id != null) endWork(id);
  },
});

export async function withWork<T>(label: string, task: () => Promise<T>, done?: string | null) {
  const id = beginWork(label);
  try {
    const value = await task();
    if (done) pushToast(done);
    return value;
  } catch (error) {
    pushToast(spoken(error), "danger");
    throw error;
  } finally {
    endWork(id);
  }
}
