import { X } from 'lucide-react';
import { useUi } from '../store/ui.js';

export default function Toaster() {
  const toasts = useUi((state) => state.toasts);
  const dismiss = useUi((state) => state.dismissToast);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto flex max-w-sm animate-fade-in items-start gap-3 rounded-lg px-4 py-3 text-sm shadow-lg ${
            toast.kind === 'error' ? 'bg-red-600 text-white' : 'bg-slate-900 text-white dark:bg-slate-700'
          }`}
        >
          <span className="min-w-0 break-words">{toast.message}</span>
          <button
            type="button"
            onClick={() => dismiss(toast.id)}
            className="-mr-1 shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
