export const PROJECT_STATUSES = [
  "planning",
  "scheduled",
  "in_production",
  "in_post",
  "awaiting_approval",
  "ready_for_publishing",
  "completed",
  "on_hold",
  "cancelled",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

const PROJECT_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  planning: ["scheduled", "on_hold", "cancelled"],
  scheduled: ["in_production", "on_hold", "cancelled"],
  in_production: ["in_post", "on_hold", "cancelled"],
  in_post: ["awaiting_approval", "ready_for_publishing", "on_hold"],
  awaiting_approval: ["ready_for_publishing", "in_post", "on_hold"],
  ready_for_publishing: ["completed", "on_hold"],
  on_hold: ["planning", "scheduled", "in_production", "in_post", "awaiting_approval", "ready_for_publishing", "cancelled"],
  completed: [],
  cancelled: [],
};

export function allowedProjectTransitions(status: ProjectStatus) {
  return PROJECT_TRANSITIONS[status];
}

export function assertProjectTransition(from: ProjectStatus, to: ProjectStatus) {
  if (!PROJECT_TRANSITIONS[from].includes(to)) {
    throw new Error(`A project cannot move from ${from} to ${to}.`);
  }
}

export const DELIVERABLE_STATUSES = [
  "available",
  "claimed",
  "in_progress",
  "on_hold",
  "submitted",
  "rework",
  "approved",
  "ready_to_publish",
  "published",
  "cancelled",
] as const;

export const OPEN_DELIVERABLE_STATUSES = ["available", "claimed", "in_progress", "on_hold", "submitted", "rework"] as const;

export const EDITING_QUEUE_STATUSES = ["available", "claimed", "in_progress", "on_hold", "submitted", "rework", "approved"] as const;

export const RESHOOT_REASONS = [
  "poor_footage",
  "technical_failure",
  "missing_shots",
  "internal_quality",
  "client_request",
  "other",
] as const;

export const PUBLISHING_STATUSES = ["ready", "scheduled", "published", "failed"] as const;

export const INVOICE_EDITABLE = ["draft", "pending_approval"] as const;
