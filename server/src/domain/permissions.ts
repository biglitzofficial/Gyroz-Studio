export const PERMISSION_CATALOG = [
  { key: "dashboard.view", group: "Overview", resource: "Dashboard", action: "View" },
  { key: "search.view", group: "Overview", resource: "Search", action: "View" },
  { key: "notifications.view", group: "Overview", resource: "Notifications", action: "View" },
  { key: "employees.view", group: "People", resource: "Employees", action: "View" },
  { key: "employees.create", group: "People", resource: "Employees", action: "Create" },
  { key: "employees.edit", group: "People", resource: "Employees", action: "Edit" },
  { key: "employees.archive", group: "People", resource: "Employees", action: "Archive" },
  { key: "employees.sensitive", group: "People", resource: "Employees", action: "Sensitive" },
  { key: "roles.manage", group: "System", resource: "Roles", action: "Manage" },
  { key: "clients.view", group: "Studio", resource: "Clients", action: "View" },
  { key: "clients.create", group: "Studio", resource: "Clients", action: "Create" },
  { key: "clients.edit", group: "Studio", resource: "Clients", action: "Edit" },
  { key: "clients.archive", group: "Studio", resource: "Clients", action: "Archive" },
  { key: "projects.view", group: "Studio", resource: "Projects", action: "View" },
  { key: "projects.create", group: "Studio", resource: "Projects", action: "Create" },
  { key: "projects.edit", group: "Studio", resource: "Projects", action: "Edit" },
  { key: "projects.assign", group: "Studio", resource: "Projects", action: "Assign" },
  { key: "shoots.view", group: "Production", resource: "Shoots", action: "View" },
  { key: "shoots.create", group: "Production", resource: "Shoots", action: "Create" },
  { key: "shoots.edit", group: "Production", resource: "Shoots", action: "Edit" },
  { key: "shoots.log", group: "Production", resource: "Shoots", action: "Log" },
  { key: "plans.view", group: "Production", resource: "Plans", action: "View" },
  { key: "plans.assign", group: "Production", resource: "Plans", action: "Assign" },
  { key: "deliverables.view", group: "Production", resource: "Deliverables", action: "View" },
  { key: "deliverables.edit", group: "Production", resource: "Deliverables", action: "Edit" },
  { key: "editing.view", group: "Production", resource: "Editing", action: "View" },
  { key: "editing.claim", group: "Production", resource: "Editing", action: "Claim" },
  { key: "editing.submit", group: "Production", resource: "Editing", action: "Submit" },
  { key: "editing.review", group: "Production", resource: "Editing", action: "Review" },
  { key: "editing.reassign", group: "Production", resource: "Editing", action: "Reassign" },
  { key: "reshoots.view", group: "Production", resource: "Reshoots", action: "View" },
  { key: "reshoots.create", group: "Production", resource: "Reshoots", action: "Create" },
  { key: "reshoots.approve", group: "Production", resource: "Reshoots", action: "Approve" },
  { key: "publishing.view", group: "Publishing", resource: "Publishing", action: "View" },
  { key: "publishing.schedule", group: "Publishing", resource: "Publishing", action: "Schedule" },
  { key: "publishing.publish", group: "Publishing", resource: "Publishing", action: "Publish" },
  { key: "invoices.view", group: "Finance", resource: "Invoices", action: "View" },
  { key: "invoices.create", group: "Finance", resource: "Invoices", action: "Create" },
  { key: "invoices.edit", group: "Finance", resource: "Invoices", action: "Edit" },
  { key: "invoices.approve", group: "Finance", resource: "Invoices", action: "Approve" },
  { key: "invoices.issue", group: "Finance", resource: "Invoices", action: "Issue" },
  { key: "payments.view", group: "Finance", resource: "Payments", action: "View" },
  { key: "payments.record", group: "Finance", resource: "Payments", action: "Record" },
  { key: "expenses.view", group: "Finance", resource: "Expenses", action: "View" },
  { key: "expenses.create", group: "Finance", resource: "Expenses", action: "Create" },
  { key: "expenses.approve", group: "Finance", resource: "Expenses", action: "Approve" },
  { key: "analytics.view", group: "Finance", resource: "Analytics", action: "View" },
  { key: "analytics.financial", group: "Finance", resource: "Analytics", action: "Financial" },
  { key: "exports.create", group: "Finance", resource: "Exports", action: "Create" },
  { key: "attendance.self", group: "People", resource: "Attendance", action: "Self" },
  { key: "attendance.view", group: "People", resource: "Attendance", action: "View" },
  { key: "attendance.manage", group: "People", resource: "Attendance", action: "Manage" },
  { key: "attendance.correct", group: "People", resource: "Attendance", action: "Correct" },
  { key: "payroll.view", group: "People", resource: "Payroll", action: "View" },
  { key: "payroll.manage", group: "People", resource: "Payroll", action: "Manage" },
  { key: "payroll.approve", group: "People", resource: "Payroll", action: "Approve" },
  { key: "payroll.sensitive", group: "People", resource: "Payroll", action: "Sensitive" },
  { key: "audit.view", group: "System", resource: "Audit", action: "View" },
  { key: "settings.manage", group: "System", resource: "Settings", action: "Manage" },
] as const;

export type PermissionKey = (typeof PERMISSION_CATALOG)[number]["key"];

export function allPermissionKeys(): PermissionKey[] {
  return PERMISSION_CATALOG.map((item) => item.key);
}

export function adminPermissions() {
  return allPermissionKeys();
}

export type RoleTemplate = {
  name: string;
  slug: string;
  systemKey: "super_admin" | "admin" | null;
  description: string;
  permissions: PermissionKey[];
  protected: boolean;
};

export function roleTemplates(): RoleTemplate[] {
  return [
    {
      name: "Super Admin",
      slug: "super-admin",
      systemKey: "super_admin",
      description: "Full company access. This role cannot be edited or assigned by anyone else.",
      permissions: allPermissionKeys(),
      protected: true,
    },
    {
      name: "Admin",
      slug: "admin",
      systemKey: "admin",
      description: "Full company access, the same as the super admin.",
      permissions: adminPermissions(),
      protected: true,
    },
    {
      name: "Cinematographer",
      slug: "cinematographer",
      systemKey: null,
      description: "Assigned shoots, production logs, and reshoot requests.",
      permissions: ["dashboard.view", "search.view", "notifications.view", "clients.view", "projects.view", "shoots.view", "shoots.log", "plans.view", "deliverables.view", "reshoots.view", "reshoots.create", "expenses.view", "expenses.create", "attendance.self"],
      protected: false,
    },
    {
      name: "Video Editor",
      slug: "video-editor",
      systemKey: null,
      description: "Editing queue, task claiming, and submissions.",
      permissions: ["dashboard.view", "search.view", "notifications.view", "clients.view", "projects.view", "deliverables.view", "editing.view", "editing.claim", "editing.submit", "plans.view", "expenses.view", "expenses.create", "attendance.self"],
      protected: false,
    },
    {
      name: "Social Media Manager",
      slug: "social-media-manager",
      systemKey: null,
      description: "Publishing calendar and manual publication records.",
      permissions: ["dashboard.view", "search.view", "notifications.view", "clients.view", "projects.view", "deliverables.view", "publishing.view", "publishing.schedule", "publishing.publish", "plans.view", "expenses.view", "expenses.create", "attendance.self"],
      protected: false,
    },
    {
      name: "Floor staff",
      slug: "floor-staff",
      systemKey: null,
      description: "Punch in, punch out, and file an expense. No one else's records.",
      permissions: ["dashboard.view", "notifications.view", "expenses.view", "expenses.create", "attendance.self"],
      protected: false,
    },
    {
      name: "Team Lead",
      slug: "team-lead",
      systemKey: null,
      description: "Team workload, reviews, and reassignment. No payroll or company financial reports.",
      permissions: ["dashboard.view", "search.view", "notifications.view", "employees.view", "clients.view", "projects.view", "shoots.view", "plans.view", "plans.assign", "deliverables.view", "editing.view", "editing.review", "editing.reassign", "reshoots.view", "publishing.view", "analytics.view", "expenses.view", "expenses.create", "attendance.view"],
      protected: false,
    },
  ];
}
