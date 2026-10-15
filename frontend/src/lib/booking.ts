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
};

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
