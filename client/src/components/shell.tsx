import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { usePhoneTables } from "@/components/phone-tables";
import {
  Banknote, Bell, CalendarDays, Camera, Clapperboard, Clock, LayoutDashboard, LineChart, ListChecks, LogOut, Menu, NotebookText, Package, QrCode,
  Receipt, ScrollText, Search, Send, Settings, Shield, Users, Wallet, X,
} from "lucide-react";
import { hasFullAccess, useAuth } from "@/lib/auth";
import { withWork } from "@/lib/feedback";
import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";

const NAV = [
  { section: "Overview", items: [
    { to: "/", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard.view" },
  ]},
  { section: "Studio", items: [
    { to: "/clients", label: "Clients", icon: Clapperboard, permission: "clients.view" },
    { to: "/projects", label: "Projects", icon: Clapperboard, permission: "projects.view" },
    { to: "/shoots", label: "Shoots", icon: Camera, permission: "shoots.view" },
    { to: "/assets", label: "Assets", icon: Package, super: true },
    { to: "/calendar", label: "Calendar", icon: CalendarDays, permission: "plans.view" },
    { to: "/editing", label: "Editing", icon: Clapperboard, permission: "editing.view" },
    { to: "/reshoots", label: "Reshoots", icon: Camera, permission: "reshoots.view" },
    { to: "/publishing", label: "Publishing", icon: Send, permission: "publishing.view" },
  ]},
  { section: "Finance", items: [
    { to: "/invoices", label: "Invoices", icon: Receipt, permission: "invoices.view" },
    { to: "/expenses", label: "Expenses", icon: Wallet, always: true },
    { to: "/analytics", label: "Analytics", icon: LineChart, permission: "analytics.financial" },
    { to: "/reports", label: "Reports", icon: NotebookText, permission: "analytics.financial" },
  ]},
  { section: "People", items: [
    { to: "/hrms", label: "HRMS", icon: Clock, super: true },
    { to: "/employees", label: "People", icon: Users, permission: "employees.view" },
    { to: "/attendance", label: "Attendance", icon: QrCode, any: ["attendance.view", "attendance.self"] },
    { to: "/work", label: "Work", icon: ListChecks, always: true },
    { to: "/payroll", label: "Payroll", icon: Banknote, always: true },
  ]},
  { section: "System", items: [
    { to: "/roles", label: "Roles", icon: Shield, permission: "roles.manage" },
    { to: "/audit", label: "Audit", icon: ScrollText, permission: "audit.view" },
    { to: "/settings", label: "Settings", icon: Settings, permission: "settings.manage" },
  ]},
];

export function Shell() {
  const { user, can, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [main, setMain] = useState<HTMLElement | null>(null);
  usePhoneTables(main);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("gyroz-nav") === "collapsed");
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState(false);
  const notes = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => (await api.get("/notifications")).data.data as Array<{ _id: string; title: string; body?: string; readAt?: string }>,
  });
  const unread = notes.data?.filter((item) => !item.readAt).length ?? 0;
  const sections = useMemo(() => NAV.map((section) => ({
    ...section,
    items: section.items.filter((item) => ("super" in item && item.super) ? hasFullAccess(user?.role.systemKey) : ("always" in item && item.always) || (item.permission ? can(item.permission) : item.any?.some((key) => can(key)))),
  })).filter((section) => section.items.length), [can, user]);

  useEffect(() => { localStorage.setItem("gyroz-nav", collapsed ? "collapsed" : "open"); }, [collapsed]);
  useEffect(() => { if (user?.mustChangePassword) navigate("/password"); }, [user, navigate]);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let remove = () => {};
    void import("@capacitor/app").then(({ App }) => App.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack) window.history.back();
      else void App.exitApp();
    })).then((handle) => { remove = () => { void handle.remove(); }; });
    return () => remove();
  }, []);

  return (
    <div className="safe-pad min-h-screen bg-paper text-ink md:grid" style={{ gridTemplateColumns: collapsed ? "76px 1fr" : "240px 1fr" }}>
      {open ? <button className="fixed inset-0 z-20 bg-ink/40 md:hidden" type="button" aria-label="Close menu" onClick={() => setOpen(false)} /> : null}
      <aside className={`${open ? "fixed inset-y-0 left-0 z-30 flex w-[min(86vw,280px)] flex-col" : "hidden"} overflow-y-auto bg-ink text-white md:sticky md:top-0 md:flex md:h-screen md:w-auto md:flex-col md:self-start`}>
        <div className="flex h-16 items-center justify-between px-4">
          <button className="text-left" onClick={() => navigate("/")} type="button">
            <div className="font-display text-2xl leading-none">Gyroz</div>
            {!collapsed ? <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-white/50">Studio</div> : null}
          </button>
          <button className="md:hidden" onClick={() => setOpen(false)} type="button" aria-label="Close menu"><X size={18} /></button>
        </div>
        <nav className="px-2 pb-6">
          {sections.map((section) => (
            <div key={section.section} className="mb-4">
              {!collapsed ? <div className="px-3 pb-2 text-[10px] uppercase tracking-[0.16em] text-white/40">{section.section}</div> : null}
              {section.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.to === "/"} onClick={() => setOpen(false)} className={({ isActive }) => `mb-0.5 flex items-center gap-3 px-3 py-2 text-[13px] text-white/75 ${isActive ? "bg-white/10 text-white shadow-[inset_2px_0_0_#FFD500]" : "hover:bg-white/5"}`}>
                  <item.icon size={16} />
                  {!collapsed ? item.label : null}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex min-h-16 items-center gap-2 border-b border-line bg-paper/95 px-3 py-2 md:gap-3 md:px-6">
          <button className="btn btn-ghost btn-sm shrink-0 md:hidden" onClick={() => setOpen(true)} type="button" aria-label="Open menu"><Menu size={16} /></button>
          <button className="btn btn-ghost btn-sm hidden shrink-0 md:inline-flex" onClick={() => setCollapsed((value) => !value)} type="button">{collapsed ? "Expand" : "Collapse"}</button>
          {can("search.view") ? (
            <form className="relative min-w-0 flex-1" onSubmit={(event) => { event.preventDefault(); if (!query.trim()) return; navigate(`/search?q=${encodeURIComponent(query)}`); }}>
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input className="control pl-9" placeholder="Search" aria-label="Search" value={query} onChange={(event) => setQuery(event.target.value)} />
            </form>
          ) : <div className="flex-1" />}
          <button className="btn btn-ghost btn-sm relative" type="button" onClick={() => navigate("/notifications")} aria-label="Notifications">
            <Bell size={16} />
            {unread ? <span className="absolute right-1 top-1 h-1.5 w-1.5 bg-accent" /> : null}
          </button>
          <div className="relative">
            <button className="flex items-center gap-2" type="button" onClick={() => setMenu((value) => !value)}>
              <span className="grid h-8 w-8 place-items-center bg-ink text-xs text-white">{user?.name.slice(0, 1)}</span>
              <span className="hidden text-left sm:block"><span className="block text-sm leading-none">{user?.name}</span><span className="text-[11px] text-muted">{user?.role.name}</span></span>
            </button>
            {menu ? (
              <div className="absolute right-0 mt-2 w-48 border border-line bg-white p-1 shadow-lift">
                <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-paper" type="button" onClick={() => { setMenu(false); navigate("/profile"); }}>Profile</button>
                <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-paper" type="button" onClick={() => { setMenu(false); navigate("/password"); }}>Change password</button>
                <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-paper" type="button" onClick={() => { setMenu(false); const door = user?.role.systemKey === "super_admin" ? "/admin" : "/login"; void withWork("Signing out", () => logout()).then(() => navigate(door)).catch(() => undefined); }}><LogOut size={14} /> Sign out</button>
              </div>
            ) : null}
          </div>
        </header>
        <main ref={setMain} className="min-w-0 px-3 py-5 sm:px-4 sm:py-6 md:px-8 md:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
