import { type ReactNode } from "react";
import { Navigate, createBrowserRouter } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { WorkScreen } from "@/components/feedback";
import { Shell } from "@/components/shell";
import { AdminLoginPage, LoginPage } from "@/pages/LoginPage";
import { ReceptionPage } from "@/pages/ReceptionPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { ClientsPage, ClientDetailPage, ProjectsPage, ProjectDetailPage, ShootsPage } from "@/pages/StudioPages";
import { CalendarPage } from "@/pages/CalendarPage";
import { EditingPage, DeliverablePage, ReshootsPage, PublishingPage } from "@/pages/ProductionPages";
import { InvoicesPage, InvoiceDetailPage, ExpensesPage, AnalyticsPage } from "@/pages/FinancePages";
import { ReportsPage } from "@/pages/ReportsPage";
import { WorkPage } from "@/pages/WorkPage";
import { EmployeesPage, EmployeeDetailPage, AttendancePage, PayrollPage } from "@/pages/PeoplePages";
import { HrmsPage } from "@/pages/HrmsPage";
import { RolesPage, SettingsPage, AuditPage, SearchPage, NotificationsPage, ProfilePage, PasswordPage } from "@/pages/SystemPages";
import { AssetDetailPage, AssetsPage } from "@/pages/AssetsPage";

function Gate({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return <WorkScreen label="Opening the studio" />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword) return <Navigate to="/password" replace />;
  return children;
}

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/admin", element: <AdminLoginPage /> },
  { path: "/reception", element: <ReceptionPage /> },
  { path: "/password", element: <PasswordPage /> },
  {
    path: "/",
    element: <Gate><Shell /></Gate>,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "clients", element: <ClientsPage /> },
      { path: "clients/:id", element: <ClientDetailPage /> },
      { path: "projects", element: <ProjectsPage /> },
      { path: "projects/:id", element: <ProjectDetailPage /> },
      { path: "shoots", element: <ShootsPage /> },
      { path: "assets", element: <AssetsPage /> },
      { path: "assets/:id", element: <AssetDetailPage /> },
      { path: "calendar", element: <CalendarPage /> },
      { path: "editing", element: <EditingPage /> },
      { path: "deliverables/:id", element: <DeliverablePage /> },
      { path: "reshoots", element: <ReshootsPage /> },
      { path: "publishing", element: <PublishingPage /> },
      { path: "invoices", element: <InvoicesPage /> },
      { path: "invoices/:id", element: <InvoiceDetailPage /> },
      { path: "expenses", element: <ExpensesPage /> },
      { path: "analytics", element: <AnalyticsPage /> },
      { path: "reports", element: <ReportsPage /> },
      { path: "work", element: <WorkPage /> },
      { path: "hrms", element: <HrmsPage /> },
      { path: "employees", element: <EmployeesPage /> },
      { path: "employees/:id", element: <EmployeeDetailPage /> },
      { path: "attendance", element: <AttendancePage /> },
      { path: "payroll", element: <PayrollPage /> },
      { path: "roles", element: <RolesPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "audit", element: <AuditPage /> },
      { path: "search", element: <SearchPage /> },
      { path: "notifications", element: <NotificationsPage /> },
      { path: "profile", element: <ProfilePage /> },
    ],
  },
]);
