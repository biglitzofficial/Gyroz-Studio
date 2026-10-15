import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { errorMessage, useStudio } from "@/lib/api";
import { withWork } from "@/lib/feedback";
import { isApp, studioAddress } from "@/lib/studio";
import { useEffect, useState } from "react";
import { ArrowRight, Crown, Eye, EyeOff, Lock, Mail, Shield } from "lucide-react";
import hero from "@/assets/gyroz-staff-bg.png";
import owner from "@/assets/gyroz-admin-bg.png";

const schema = z.object({
  email: z.string().email("Enter a valid email."),
  password: z.string().min(1, "Enter your password."),
});

export function LoginPage() {
  const { user, login } = useAuth();
  const [formError, setFormError] = useState("");
  const [studio, setStudio] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [resetNote, setResetNote] = useState(false);
  const app = isApp();
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } });
  useEffect(() => { if (app) void studioAddress().then(setStudio); }, [app]);
  if (user) return <Navigate to="/" replace />;
  return (
    <div className="safe-pad relative min-h-screen overflow-hidden bg-ink text-white lg:h-screen">
      <img className="absolute inset-0 h-full w-full object-cover object-center" src={hero} alt="" />
      <div className="relative flex min-h-screen flex-col lg:h-screen">
        <div className="flex w-full flex-1 items-center justify-center px-4 py-8 lg:justify-end lg:px-12">
          <form className="w-full max-w-[400px] rounded-2xl border border-white/10 bg-[#141414] p-7 shadow-[0_24px_80px_rgba(0,0,0,0.45)]" onSubmit={form.handleSubmit(async (values) => {
            setFormError("");
            try {
              await withWork("Signing in", async () => {
                if (app) await useStudio(studio);
                await login(values.email, values.password, (signedIn) => signedIn.role.systemKey === "super_admin" ? "This account cannot sign in here." : true);
              });
            } catch (error) { setFormError(error instanceof Error && !("isAxiosError" in error) ? error.message : errorMessage(error)); }
          })}>
            <div className="text-center text-[11px] font-medium uppercase tracking-[0.22em] text-white/55">Welcome to</div>
            <h1 className="mt-2 text-center text-[28px] font-semibold tracking-tight">Gyroz Studio</h1>
            <p className="mt-2 text-center text-sm text-white/60">Sign in to access your studio workspace.</p>
            {app ? (
              <label className="mt-6 block text-sm">
                <span className="text-white/80">Studio address</span>
                <input className="mt-2 h-11 w-full rounded-lg border border-white/15 bg-transparent px-3 text-sm outline-none placeholder:text-white/35 focus:border-accent" inputMode="url" autoCapitalize="off" autoCorrect="off" placeholder="http://192.168.1.20:4000" value={studio} onChange={(event) => setStudio(event.target.value)} />
              </label>
            ) : null}
            <label className="mt-6 block text-sm">
              <span className="text-white/80">Email</span>
              <span className="relative mt-2 block">
                <Mail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={16} />
                <input className="h-11 w-full rounded-lg border border-white/15 bg-transparent pl-10 pr-3 text-sm outline-none placeholder:text-white/35 focus:border-accent" type="email" autoComplete="username" placeholder="Enter your email" {...form.register("email")} />
              </span>
              {form.formState.errors.email ? <span className="mt-1 block text-xs text-danger">{form.formState.errors.email.message}</span> : null}
            </label>
            <label className="mt-4 block text-sm">
              <span className="text-white/80">Password</span>
              <span className="relative mt-2 block">
                <Lock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={16} />
                <input className="h-11 w-full rounded-lg border border-white/15 bg-transparent pl-10 pr-10 text-sm outline-none placeholder:text-white/35 focus:border-accent" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" {...form.register("password")} />
                <button className="absolute right-3 top-1/2 -translate-y-1/2 text-white/45" type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((current) => !current)}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
              {form.formState.errors.password ? <span className="mt-1 block text-xs text-danger">{form.formState.errors.password.message}</span> : null}
            </label>
            <div className="mt-4 flex items-center justify-between gap-3 text-xs">
              <label className="flex items-center gap-2 text-white/75">
                <input className="accent-accent" type="checkbox" defaultChecked />
                Keep me signed in
              </label>
              <button className="text-accent" type="button" onClick={() => setResetNote(true)}>Forgot password?</button>
            </div>
            {resetNote ? <p className="mt-3 text-xs text-white/70">Ask your administrator to reset the password.</p> : null}
            {formError ? <p className="mt-3 text-sm text-danger">{formError}</p> : null}
            <button className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent font-medium text-ink hover:bg-accent-hover disabled:opacity-45" type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Signing in" : "Sign in"}
              {form.formState.isSubmitting ? null : <ArrowRight size={16} />}
            </button>
            <p className="mt-6 text-center text-xs text-white/50">New here? Contact your administrator.</p>
          </form>
        </div>
      </div>
    </div>
  );
}

export function AdminLoginPage() {
  const { user, login } = useAuth();
  const [formError, setFormError] = useState("");
  const [studio, setStudio] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [resetNote, setResetNote] = useState(false);
  const app = isApp();
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } });
  useEffect(() => { if (app) void studioAddress().then(setStudio); }, [app]);
  if (user?.role.systemKey === "super_admin") return <Navigate to="/" replace />;
  return (
    <div className="safe-pad relative min-h-screen overflow-hidden bg-[#100e0c] text-white lg:h-screen">
      <img className="absolute inset-0 h-full w-full object-cover object-center" src={owner} alt="" />
      <div className="relative flex min-h-screen items-center justify-center p-4 lg:justify-end lg:px-12">
        <div className="flex w-full max-w-[440px] items-center justify-center">
          <form className="w-full max-w-[400px] rounded-2xl border border-[#e0c36a]/80 bg-[#14120f] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)]" onSubmit={form.handleSubmit(async (values) => {
            setFormError("");
            try {
              await withWork("Signing in", async () => {
                if (app) await useStudio(studio);
                await login(values.email, values.password, (signedIn) => signedIn.role.systemKey === "super_admin" ? true : "This entrance is only for the super admin.");
              });
            } catch (error) { setFormError(error instanceof Error && !("isAxiosError" in error) ? error.message : errorMessage(error)); }
          })}>
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-[#e0c36a] text-ink"><Crown size={18} /></span>
              <span>
                <span className="block text-sm font-semibold tracking-wide">Gyroz Studio</span>
                <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-[#e0c36a]">Super admin · Owner access</span>
              </span>
            </div>
            <h1 className="mt-5 text-[30px] font-semibold leading-tight">Your studio.<br />Your vision.</h1>
            <p className="mt-2 text-sm text-white/60">Sign in to access the command center. Manage the team, projects, finances, and the studio.</p>
            {app ? (
              <label className="mt-5 block text-sm">
                <span>Studio address</span>
                <input className="mt-2 h-11 w-full rounded-lg border border-white/15 bg-black/30 px-3 text-sm outline-none placeholder:text-white/35 focus:border-[#e0c36a]" inputMode="url" autoCapitalize="off" autoCorrect="off" placeholder="http://192.168.1.20:4000" value={studio} onChange={(event) => setStudio(event.target.value)} />
              </label>
            ) : null}
            <label className="mt-4 block text-sm">
              <span>Email address</span>
              <span className="relative mt-2 block">
                <Mail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={16} />
                <input className="h-11 w-full rounded-lg border border-white/15 bg-black/30 pl-10 pr-3 text-sm outline-none placeholder:text-white/35 focus:border-[#e0c36a]" type="email" autoComplete="username" placeholder="Enter your owner email" {...form.register("email")} />
              </span>
              {form.formState.errors.email ? <span className="mt-1 block text-xs text-danger">{form.formState.errors.email.message}</span> : null}
            </label>
            <label className="mt-4 block text-sm">
              <span>Password</span>
              <span className="relative mt-2 block">
                <Lock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={16} />
                <input className="h-11 w-full rounded-lg border border-white/15 bg-black/30 pl-10 pr-10 text-sm outline-none placeholder:text-white/35 focus:border-[#e0c36a]" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" {...form.register("password")} />
                <button className="absolute right-3 top-1/2 -translate-y-1/2 text-white/45" type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((current) => !current)}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
              {form.formState.errors.password ? <span className="mt-1 block text-xs text-danger">{form.formState.errors.password.message}</span> : null}
            </label>
            <div className="mt-4 flex items-center justify-between gap-3 text-xs">
              <label className="flex items-center gap-2 text-white/75">
                <input className="accent-[#e0c36a]" type="checkbox" defaultChecked />
                Keep me signed in
              </label>
              <button className="text-[#e0c36a]" type="button" onClick={() => setResetNote(true)}>Forgot password?</button>
            </div>
            {resetNote ? <p className="mt-3 text-xs text-white/70">Ask your administrator to reset the password.</p> : null}
            {formError ? <p className="mt-3 text-sm text-danger">{formError}</p> : null}
            {user && user.role.systemKey !== "super_admin" ? <p className="mt-3 text-sm text-white/70">Signed in as {user.name}. <Link to="/">Return to the studio</Link></p> : null}
            <button className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#e0c36a] font-medium text-ink hover:bg-[#c9ad55] disabled:opacity-45" type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Signing in" : "Access command center"}
              {form.formState.isSubmitting ? null : <ArrowRight size={16} />}
            </button>
            <p className="mt-4 text-center text-[11px] tracking-[0.16em] text-white/40">OR</p>
            <Link className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-[#e0c36a]/50 text-sm text-[#e0c36a]" to="/login">Staff entrance <ArrowRight size={14} /></Link>
            <p className="mt-4 flex items-start gap-2 text-[11px] leading-relaxed text-white/45"><Shield size={14} className="mt-0.5 shrink-0 text-[#e0c36a]" /> Protected access. Permissions stay on the server.</p>
          </form>
        </div>
      </div>
    </div>
  );
}
