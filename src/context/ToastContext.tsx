import React, { createContext, useCallback, useContext, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export type ToastVariant = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  variant: ToastVariant;
  message: string;
}

interface ToastContextValue {
  pushToast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const pushToast = useCallback(
    (message: string, variant: ToastVariant = 'success') => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-3), { id, variant, message }]);
      window.setTimeout(() => {
        dismiss(id);
      }, 4200);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ pushToast }}>
      {children}
      <div
        aria-live="polite"
        aria-label="Notifications"
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)] pointer-events-none"
      >
        {toasts.map((toast) => {
          const icon =
            toast.variant === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-[var(--dp-success)]" />
            ) : toast.variant === 'error' ? (
              <AlertCircle className="w-4 h-4 shrink-0 text-[var(--dp-error)]" />
            ) : (
              <Info className="w-4 h-4 shrink-0 text-[var(--dp-primary)]" />
            );

          return (
            <div
              key={toast.id}
              role="status"
              className="pointer-events-auto flex items-start gap-2.5 px-4 py-3 rounded-[var(--dp-radius-md)] bg-[var(--dp-surface-container-lowest)] border border-[var(--dp-outline-variant)] shadow-lg text-[13px] text-[var(--dp-on-surface)] transition-all duration-150"
            >
              <span className="mt-0.5">{icon}</span>
              <span className="flex-1 leading-snug">{toast.message}</span>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => dismiss(toast.id)}
                className="p-0.5 rounded text-[var(--dp-on-surface-variant)] hover:text-[var(--dp-on-surface)] transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used inside ToastProvider');
  }
  return ctx;
}
