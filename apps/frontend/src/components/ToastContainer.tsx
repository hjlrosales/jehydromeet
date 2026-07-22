'use client';

import type { Toast, ToastType } from '@/hooks/useToast';

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

const typeStyles = {
  info: {
    bg: 'bg-blue-900/90 dark:bg-blue-900/80',
    icon: 'text-blue-300',
    border: 'border-blue-700/50',
  },
  success: {
    bg: 'bg-emerald-900/90 dark:bg-emerald-900/80',
    icon: 'text-emerald-300',
    border: 'border-emerald-700/50',
  },
  warning: {
    bg: 'bg-amber-900/90 dark:bg-amber-900/80',
    icon: 'text-amber-300',
    border: 'border-amber-700/50',
  },
  error: {
    bg: 'bg-red-900/90 dark:bg-red-900/80',
    icon: 'text-red-300',
    border: 'border-red-700/50',
  },
};

function ToastIcon({ type }: { type: ToastType }) {
  const cls = `h-4 w-4 ${typeStyles[type]?.icon ?? 'text-slate-300'}`;
  switch (type) {
    case 'success':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={cls}>
          <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
        </svg>
      );
    case 'warning':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={cls}>
          <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
        </svg>
      );
    case 'error':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={cls}>
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
        </svg>
      );
    default:
      return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={cls}>
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
        </svg>
      );
  }
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((toast) => {
        const style = typeStyles[toast.type] ?? typeStyles.info;
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex animate-slide-up items-center gap-2.5 rounded-lg border px-4 py-2.5 shadow-lg backdrop-blur-sm ${style!.bg} ${style!.border}`}
          >
            <ToastIcon type={toast.type} />
            <span className="text-sm font-medium text-white">{toast.message}</span>
            <button
              onClick={() => onDismiss(toast.id)}
              className="ml-2 rounded p-0.5 text-white/60 transition-colors hover:text-white/90"
              aria-label="Dismiss"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
