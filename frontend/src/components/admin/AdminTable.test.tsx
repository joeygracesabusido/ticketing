// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { AdminTable } from "./AdminTable"

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
    fireEvent.click(screen.getByText("Edit"))
    fireEvent.click(screen.getByText("Delete"))
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})
