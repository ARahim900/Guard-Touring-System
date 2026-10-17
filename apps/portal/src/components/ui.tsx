// =============================================================================
// Reusable UI pieces styled with the Muscat Bay tokens (see index.css).
// =============================================================================
import { Loader2, X } from 'lucide-react';
import { useEffect, type ButtonHTMLAttributes, type ComponentType, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

import type { Tone } from '@/lib/labels';

type Icon = ComponentType<{ className?: string }>;

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// -------------------------------------------------------------------- Button
type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost' | 'success';
const BTN: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-hover',
  secondary: 'bg-secondary text-primary hover:bg-secondary-active',
  outline: 'bg-card text-primary border border-border hover:bg-muted',
  danger: 'bg-danger text-white hover:bg-danger-hover',
  success: 'bg-success text-white hover:bg-[#6B9A87]',
  ghost: 'text-primary hover:bg-muted',
};

export function Button({
  variant = 'primary',
  loading,
  icon: I,
  children,
  className,
  disabled,
  size = 'md',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean; icon?: Icon; size?: 'sm' | 'md' }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-sm font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-9 px-3 text-sm' : 'h-10 px-4 text-sm',
        BTN[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : I ? <I className="size-4" /> : null}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------- Card
export function Card({ children, className, title, action }: { children: ReactNode; className?: string; title?: string; action?: ReactNode }) {
  return (
    <section className={cx('rounded-lg border border-border bg-card shadow-card', className)}>
      {title ? (
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2 className="text-base">{title}</h2>
          {action}
        </header>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  );
}

// --------------------------------------------------------------------- Badge
const TONE: Record<Tone, string> = {
  success: 'bg-success-bg text-success-text',
  warning: 'bg-warning-bg text-warning-text',
  danger: 'bg-danger-bg text-danger-text',
  info: 'bg-info-bg text-info-text',
  neutral: 'bg-muted text-foreground',
  brand: 'bg-secondary-light text-primary',
};
export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  return <span className={cx('inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-semibold whitespace-nowrap', TONE[tone])}>{label}</span>;
}

// --------------------------------------------------------------- Form fields
const inputCls =
  'h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-secondary';

export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={cx('flex flex-col gap-1', className)}>
      <span className="text-sm font-medium">{label}</span>
      {children}
      {error ? <span className="text-xs text-danger-text">{error}</span> : hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}

export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cx(inputCls, props.className)}>
      {children}
    </select>
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputCls, 'h-auto min-h-20 py-2', props.className)} />;
}

// --------------------------------------------------------------------- Modal
export function Modal({ open, title, onClose, children, footer, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx('w-full rounded-lg bg-card shadow-card', wide ? 'max-w-4xl' : 'max-w-lg')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base">{title}</h2>
          <button onClick={onClose} className="rounded-sm p-1 text-muted-foreground hover:bg-muted" aria-label="Close">
            <X className="size-5" />
          </button>
        </header>
        <div className="max-h-[75vh] overflow-y-auto p-5">{children}</div>
        {footer ? <footer className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer> : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------- Loading and empty
export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground" role="status">
      <Loader2 className="size-5 animate-spin" /> {label}
    </div>
  );
}

export function EmptyState({ icon: I, title, message, action }: { icon: Icon; title: string; message?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-secondary-light text-primary">
        <I className="size-6" />
      </div>
      <p className="font-semibold text-primary">{title}</p>
      {message ? <p className="max-w-sm text-sm text-muted-foreground">{message}</p> : null}
      {action}
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger-text" role="alert">{message}</p>;
}

// --------------------------------------------------------------- PageHeader
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl">{title}</h1>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

// ----------------------------------------------------------------- StatCard
export function StatCard({ label, value, hint, icon: I, tone = 'brand' }: { label: string; value: ReactNode; hint?: string; icon: Icon; tone?: Tone }) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-card p-4 shadow-card">
      <div className={cx('flex size-11 items-center justify-center rounded-md', TONE[tone])}>
        <I className="size-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold text-primary">{value}</p>
        {hint ? <p className="truncate text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- Table
export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border text-xs text-muted-foreground uppercase">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={cx('px-3 py-2.5 align-top', className)}>{children}</td>
);
