import { supabase } from "./supabase"

// Thin wrappers over SECURITY DEFINER RPCs (authoritative logic lives in SQL).
// Frontend never computes the payable total for charging — it only previews.

export type CreateBookingArgs = {
  tripId: string
  accommodationId: string
  pax: number
  name: string
  email: string
  phone: string
  // Full name per passenger, index 0 = booker. Omitted/null = legacy
  // server behavior (booker name + 'Passenger 2..N').
  passengerNames?: string[] | null
};

// Build the per-passenger array from the booker name + extra inputs.
// Returns null for single-pax (no param needed). Pads/trims defensively;
// the server re-validates count and each name.
export function buildPassengerNames(fullName: string, pax: number, extra: string[]): string[] | null {
  if (pax <= 1) return null
  const names = [fullName.trim(), ...extra.slice(0, Math.max(0, pax - 1)).map((n) => (n ?? "").trim())]
  while (names.length < pax) names.push("")
  return names
}

// 0-based index of the first name shorter than 2 chars, or -1 when all valid.
export function missingPassengerIndex(names: string[] | null | undefined): number {
  if (!names) return -1
  return names.findIndex((n) => (n ?? "").trim().length < 2)
}

export async function createBooking(a: CreateBookingArgs) {
  if (!supabase) throw new Error("Supabase not configured")
  const idempotency = `bk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const { data, error } = await supabase.rpc("create_booking", {
    p_trip_id: a.tripId,
    p_accommodation_id: a.accommodationId,
    p_pax: a.pax,
    p_name: a.name,
    p_email: a.email,
    p_phone: a.phone,
    p_idempotency: idempotency,
    p_passenger_names: a.passengerNames ?? null,
  });
  if (error) throw new Error(error.message)
  return data as any
}

export async function createPaymentIntent(bookingId: string, method: string) {
  if (!supabase) throw new Error("Supabase not configured")
  const idempotency = `pay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const { data, error } = await supabase.rpc("create_payment_intent", {
    p_booking_id: bookingId,
    p_method: method,
    p_idempotency: idempotency,
  });
  if (error) throw new Error(error.message)
  return data as any
}

export async function cancelBooking(bookingId: string) {
  if (!supabase) throw new Error("Supabase not configured")
  const { data, error } = await supabase.rpc("cancel_booking", { p_booking_id: bookingId });
  if (error) throw new Error(error.message)
  return data as any
}

// Countdown helpers for the 4h reservation hold.
export function msRemaining(expiresAt: string): number {
  return new Date(expiresAt).getTime() - Date.now()
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return "Expired"
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`
}

export function isExpired(expiresAt: string): boolean {
  return msRemaining(expiresAt) <= 0
}
