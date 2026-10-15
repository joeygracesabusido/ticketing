// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { AdminTable, StatusBadge } from "./AdminTable"

describe("AdminTable", () => {
  it("renders rows and fires edit/delete", () => {
    const onAdd = vi.fn()
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    render(
      <AdminTable
        title="Ports"
        columns={[{ key: "code", label: "Code" }]}
        rows={[{ id: "1", code: "MNL" }]}
        onAdd={onAdd}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    )
    expect(screen.getByText("MNL")).toBeTruthy()
    fireEvent.click(screen.getByLabelText("Edit"))
    fireEvent.click(screen.getByLabelText("Delete"))
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it("maps status values to semantic tints", () => {
    render(<StatusBadge value="paid" />)
    expect(screen.getByText("Paid").className).toContain("emerald")
    render(<StatusBadge value="weird-new-value" />)
    expect(screen.getByText("Weird-new-value").className).toContain("primary")
  })
})
