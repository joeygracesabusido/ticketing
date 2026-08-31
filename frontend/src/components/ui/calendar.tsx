import * as React from "react"
import { cn } from "@/lib/utils"

export type CalendarProps = {
  className?: string
  selected?: Date
  onSelect?: (date: Date | undefined) => void
  mode?: string
  disabled?: (date: Date) => boolean
}

function Calendar({ className, selected, onSelect }: CalendarProps) {
  const [currentMonth, setCurrentMonth] = React.useState(() => {
    const d = selected || new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })

  const handleSelect = (day: number) => {
    const newDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day)
    onSelect?.(newDate)
  }

  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate()
  const startDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay()

  const weeks: (number | null)[][] = []
  let week: (number | null)[] = Array(startDay).fill(null)
  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d)
    if (week.length === 7) {
      weeks.push(week)
      week = []
    }
  }
  if (week.length) {
    while (week.length < 7) week.push(null)
    weeks.push(week)
  }

  const isSelected = (day: number | null) => {
    if (!day || !selected) return false
    return (
      day === selected.getDate() &&
      currentMonth.getMonth() === selected.getMonth() &&
      currentMonth.getFullYear() === selected.getFullYear()
    )
  }

  return (
    <div className={cn("p-3", className)}>
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}
          className="p-1 hover:bg-accent rounded"
        >
          {"<"}
        </button>
        <div className="text-sm font-medium">
          {currentMonth.toLocaleString("default", { month: "long", year: "numeric" })}
        </div>
        <button
          type="button"
          onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}
          className="p-1 hover:bg-accent rounded"
        >
          {">"}
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground mb-1">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
          <div key={d} className="h-8 w-8 flex items-center justify-center">
            {d}
          </div>
        ))}
      </div>
      {weeks.map((w, i) => (
        <div key={i} className="grid grid-cols-7 gap-1">
          {w.map((day, idx) => (
            <div key={idx} className="h-8 w-8 flex items-center justify-center">
              {day ? (
                <button
                  type="button"
                  onClick={() => handleSelect(day)}
                  className={cn(
                    "h-8 w-8 rounded-md text-sm hover:bg-accent",
                    isSelected(day) && "bg-primary text-primary-foreground hover:bg-primary"
                  )}
                >
                  {day}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
Calendar.displayName = "Calendar"

export { Calendar }
