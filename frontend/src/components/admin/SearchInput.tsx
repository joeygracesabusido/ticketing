import * as React from "react"
import { Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"

export function SearchInput({
  value,
  onChange,
  placeholder,
  id = "resource-search",
  label,
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  id?: string
  label?: string
  className?: string
}) {
  const inputId = React.useId()
  const resolvedId = id === "resource-search" ? inputId : id
  return (
    <div className={className}>
      {label && (
        <label htmlFor={resolvedId} className="mb-1.5 block text-xs font-medium text-muted-foreground">
          {label}
        </label>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          id={resolvedId}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="pl-9 pr-9"
        />
        {value && (
          <button
            type="button"
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onChange("")}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}
