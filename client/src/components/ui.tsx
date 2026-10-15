import { useEffect, type ReactNode } from "react";
import { formatStamp, statusTone, titleCase } from "@/lib/format";
import { useAuth } from "@/lib/auth";

export function SavedMark() {
  return <span className="text-sm text-muted">Saved</span>;
}

export function SaveAction({
  changed,
  stored = false,
  pending = false,
  label,
  className = "",
  type = "submit",
  variant = "primary",
  size = "md",
  disabled,
  onClick,
}: {
  changed: boolean;
  stored?: boolean;
  pending?: boolean;
  label: string;
  className?: string;
  type?: "submit" | "button";
  variant?: "primary" | "ink" | "ghost" | "danger";
  size?: "md" | "sm";
  disabled?: boolean;
  onClick?: () => void;
}) {
  if (!changed && stored) return <SavedMark />;
  return <Button className={className} type={type} variant={variant} size={size} disabled={disabled || pending} onClick={onClick}>{pending ? "Saving" : label}</Button>;
}

export function Button({
  variant = "primary",
  size = "md",
  type = "button",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ink" | "ghost" | "danger"; size?: "md" | "sm" }) {
  return <button type={type} className={`btn btn-${variant} ${size === "sm" ? "btn-sm" : ""} ${className}`} {...props} />;
}

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error ? <span className="error">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export function TextInput({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`control ${className}`} {...props} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="control" {...props} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="control" {...props} />;
}

export function Status({ value }: { value?: string | null }) {
  return <span className={`badge tone-${statusTone(value)}`}><i />{titleCase(value)}</span>;
}

export function PageHeader({ eyebrow, title, text, actions }: { eyebrow?: string; title: string; text?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow ? <div className="eyebrow mb-2">{eyebrow}</div> : null}
        <h1 className="text-2xl font-medium leading-none tracking-tight sm:text-[28px]">{title}</h1>
        {text ? <p className="mt-2 max-w-2xl text-sm text-muted">{text}</p> : null}
      </div>
      {actions ? <div className="page-actions flex w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div> : null}
    </div>
  );
}

export function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="border border-line bg-white px-6 py-12">
      <div className="mb-4 h-[3px] w-10 bg-accent" />
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-muted">{text}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function LoadingRows() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, index) => <div key={index} className="skeleton h-12 w-full" />)}
    </div>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 p-3 sm:items-center sm:p-4" role="presentation" onMouseDown={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-auto bg-white p-4 shadow-lift sm:p-6" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-lg font-medium">{title}</h2>
          <button className="text-sm text-muted" onClick={onClose} type="button">Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Timeline({ items }: { items: Array<{ id: string; at?: string | null; text: string }> }) {
  const { user } = useAuth();
  const zone = user?.studio?.businessTimezone ?? "Asia/Kolkata";
  const rows = items
    .filter((item) => item.text)
    .sort((a, b) => new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime());
  if (!rows.length) return <p className="px-4 py-6 text-sm text-muted">Nothing recorded yet.</p>;
  return (
    <ol>
      {rows.map((item) => (
        <li key={item.id} className="grid grid-cols-1 gap-1 border-b border-line px-4 py-3 text-sm last:border-0 sm:grid-cols-[168px_minmax(0,1fr)] sm:items-baseline sm:gap-4">
          <time className="num text-muted" dateTime={item.at || undefined}>{formatStamp(item.at, zone)}</time>
          <span>{item.text}</span>
        </li>
      ))}
    </ol>
  );
}

export function Notice({ tone = "neutral", children }: { tone?: "neutral" | "warning" | "danger" | "success"; children: ReactNode }) {
  const map = { neutral: "bg-white border-line", warning: "bg-[#f8f0de] border-[#ead7ae]", danger: "bg-[#f8e8e6] border-[#efc6c2]", success: "bg-[#e7f3ec] border-[#cfe4d8]" };
  return <div className={`border px-3 py-2 text-sm ${map[tone]}`}>{children}</div>;
}
