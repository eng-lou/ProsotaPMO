// Shown in place of a module's "Loading…" when its period/schedule bootstrap
// failed (2026-09-25). Every period-scoped module only finishes its own
// loading once a period exists, so before this, a failed bootstrap left the
// module on "Loading…" forever with the error never shown.
export function ModuleLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="p-8 text-sm max-w-xl">
      <p className="text-gray-700 dark:text-prosota-paper font-medium mb-1">This module couldn't load</p>
      <p className="text-gray-500 dark:text-prosota-muted mb-4">{message}</p>
      <button
        onClick={onRetry}
        className="text-sm bg-blue-600 dark:bg-prosota-azure text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors"
      >
        Retry
      </button>
    </div>
  )
}
