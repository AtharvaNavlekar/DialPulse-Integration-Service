import React, { useEffect } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Info,
  Moon,
  Sun,
  X,
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext.tsx';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger';
export type ButtonSize = 'sm' | 'md';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  children,
  ...props
}: ButtonProps) {
  const sizeClass =
    size === 'sm'
      ? 'h-8 px-3 text-[12px] rounded-[var(--dp-radius-sm)] gap-1.5'
      : 'h-9 px-4 text-[13px] rounded-[var(--dp-radius-sm)] gap-2';

  const variantClass =
    variant === 'primary'
      ? 'bg-[var(--dp-primary)] text-[var(--dp-on-primary)] hover:bg-[var(--dp-primary-hover)] font-semibold border border-transparent'
      : variant === 'secondary'
        ? 'bg-[var(--dp-surface-container-lowest)] text-[var(--dp-on-surface)] border border-[var(--dp-outline-variant)] hover:bg-[var(--dp-surface-variant)] font-medium'
        : variant === 'danger'
          ? 'bg-[var(--dp-error)] text-[var(--dp-on-error)] hover:opacity-90 font-semibold border border-transparent'
          : 'bg-transparent text-[var(--dp-on-surface-variant)] hover:bg-[var(--dp-surface-variant)] hover:text-[var(--dp-on-surface)] font-medium border border-transparent';

  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center whitespace-nowrap shrink-0 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dp-primary)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--dp-surface)] disabled:opacity-50 disabled:pointer-events-none cursor-pointer ${sizeClass} ${variantClass} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-[var(--dp-surface-container-lowest)] border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-md)] ${className}`}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[24px] md:text-[28px] leading-tight font-semibold tracking-tight text-[var(--dp-on-surface)]">
          {title}
        </h1>
        {description && (
          <p className="text-[13px] leading-relaxed text-[var(--dp-on-surface-variant)] mt-1">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
}

export const INPUT_BASE_CLASS =
  'w-full px-3.5 py-2 text-[14px] bg-[var(--dp-surface-container-lowest)] text-[var(--dp-on-surface)] placeholder:text-[var(--dp-outline)] border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-sm)] transition-colors duration-150 focus:outline-none focus:border-[var(--dp-primary)] focus:ring-2 focus:ring-[var(--dp-primary)]/20 disabled:bg-[var(--dp-surface-variant)] disabled:text-[var(--dp-on-surface-variant)] disabled:cursor-not-allowed';

export const SELECT_BASE_CLASS =
  'dp-select px-3 py-2 text-[13px] bg-[var(--dp-surface-container-lowest)] text-[var(--dp-on-surface)] border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-sm)] transition-colors duration-150 focus:outline-none focus:border-[var(--dp-primary)] focus:ring-2 focus:ring-[var(--dp-primary)]/20 disabled:bg-[var(--dp-surface-variant)] disabled:text-[var(--dp-on-surface-variant)] disabled:cursor-not-allowed';

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="tablist"
      className="inline-flex items-center gap-1 p-1 bg-[var(--dp-surface-container)] border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-sm)]"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1.5 text-[12px] font-medium rounded-[6px] transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
              active
                ? 'bg-[var(--dp-surface-container-lowest)] text-[var(--dp-on-surface)] shadow-xs border border-[var(--dp-outline-variant)]/60'
                : 'text-[var(--dp-on-surface-variant)] hover:text-[var(--dp-on-surface)] border border-transparent'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export type SemanticStatus =
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'neutral';

export function StatusIndicator({
  tone,
  label,
}: {
  tone: SemanticStatus;
  label: string;
}) {
  const config =
    tone === 'success'
      ? {
          color: 'text-[var(--dp-success-text)]',
          Icon: CheckCircle2,
        }
      : tone === 'warning'
        ? {
            color: 'text-[var(--dp-warning-text)]',
            Icon: Clock,
          }
        : tone === 'error'
          ? {
              color: 'text-[var(--dp-error)]',
              Icon: AlertCircle,
            }
          : tone === 'info'
            ? {
                color: 'text-[var(--dp-primary)]',
                Icon: Info,
              }
            : {
                color: 'text-[var(--dp-on-surface-variant)]',
                Icon: Clock,
              };

  const Icon = config.Icon;

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[12px] font-medium whitespace-nowrap ${config.color}`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function AlertBanner({
  tone,
  message,
}: {
  tone: 'success' | 'error' | 'warning' | 'info';
  message: string;
}) {
  const styles =
    tone === 'success'
      ? 'bg-[var(--dp-success-container)] text-[var(--dp-on-success-container)] border-[var(--dp-success)]/30'
      : tone === 'error'
        ? 'bg-[var(--dp-error-container)] text-[var(--dp-on-error-container)] border-[var(--dp-error)]/30'
        : tone === 'warning'
          ? 'bg-[var(--dp-warning-container)] text-[var(--dp-on-warning-container)] border-[var(--dp-warning)]/30'
          : 'bg-[var(--dp-primary-container)] text-[var(--dp-on-primary-container)] border-[var(--dp-primary)]/30';

  const Icon =
    tone === 'success'
      ? CheckCircle2
      : tone === 'error' || tone === 'warning'
        ? AlertCircle
        : Info;

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2.5 px-4 py-3 rounded-[var(--dp-radius-sm)] border text-[13px] font-medium ${styles}`}
    >
      <Icon className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
      <span className="leading-snug">{message}</span>
    </div>
  );
}

export function ThemeToggleButton({
  showLabel = false,
  className = '',
}: {
  showLabel?: boolean;
  className?: string;
}) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={`inline-flex items-center justify-center gap-1.5 h-9 px-2.5 rounded-[var(--dp-radius-sm)] border border-[var(--dp-outline-variant)] bg-[var(--dp-surface-container-lowest)] text-[var(--dp-on-surface-variant)] hover:text-[var(--dp-on-surface)] hover:bg-[var(--dp-surface-variant)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dp-primary)] whitespace-nowrap cursor-pointer ${className}`}
    >
      {isDark ? (
        <Sun className="w-4 h-4 shrink-0" aria-hidden="true" />
      ) : (
        <Moon className="w-4 h-4 shrink-0" aria-hidden="true" />
      )}
      {showLabel && (
        <span className="text-[12px] font-medium">
          {isDark ? 'Light' : 'Dark'}
        </span>
      )}
    </button>
  );
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        className="w-full max-w-md bg-[var(--dp-surface-container-lowest)] border border-[var(--dp-outline-variant)] rounded-[var(--dp-radius-lg)] p-6 space-y-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2
            id="confirm-modal-title"
            className="text-[17px] font-semibold text-[var(--dp-on-surface)]"
          >
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close modal"
            disabled={busy}
            onClick={onCancel}
            className="p-1 rounded-[var(--dp-radius-sm)] text-[var(--dp-on-surface-variant)] hover:text-[var(--dp-on-surface)] hover:bg-[var(--dp-surface-variant)] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[13px] leading-relaxed text-[var(--dp-on-surface-variant)]">
          {description}
        </p>
        <div className="flex items-center justify-end gap-2.5 pt-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Processing...' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
