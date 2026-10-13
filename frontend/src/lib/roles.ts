export type Role = "admin" | "manager"

export function isAdmin(role: string | null | undefined): boolean {
  return role === "admin"
}
