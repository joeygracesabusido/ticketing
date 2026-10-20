import { cn } from "@/lib/utils"

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

export function PageNotice({
  notice,
  onDismiss,
  className,
}: {
  notice: { text: string; tone: "success" | "error" | "info" } | null
  onDismiss?: () => void
  className?: string
}) {
  if (!notice) return null
  const tones = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
    error: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200",
    info: "border-border bg-muted/50 text-foreground",
  }
  return (
    <div
      role={notice.tone === "error" ? "alert" : "status"}
      className={cn("flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm", tones[notice.tone], className)}
    >
      <span>{notice.text}</span>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          className="shrink-0 rounded text-xs underline underline-offset-2 opacity-80 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      )}
    </div>
  )
}
