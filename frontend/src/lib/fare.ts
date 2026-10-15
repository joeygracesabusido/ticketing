// Fare + Philippine VAT breakdown — integer centavos, no float errors.
// Rule: domestic passenger sea transport = 12% VAT, fares VAT-INCLUSIVE
// (NIRC Sec.108 / RR 16-2005 / RMC 31-2008; international exempt per RA 10378).
// Matches SQL create_booking(): total = fare*pax - discount; net = total/1.12.
// NOT legal advice — confirm with PH tax professional before calling compliant.
export const VAT_RATE = 0.12;

export function toCentavos(pesos: number | string): number {
  return Math.round(Number(pesos) * 100);
}

export function fromCentavos(c: number): number {
  return c / 100;
}

export function formatPeso(pesos: number | string): string {
  return new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(pesos));
}

export type FareInput = {
  farePerPax: number; // VAT-inclusive pesos
  pax: number;
  discountTotal?: number; // pesos, subtracted before VAT split (senior/PWD/etc.)
  vatRate?: number; // default 0.12
};

export type FareBreakdown = {
  farePerPax: number;
  pax: number;
  gross: number;
  discount: number;
  total: number; // authoritative payable (VAT-inclusive)
  net: number; // VAT-exclusive base
  vatRate: number;
  vat: number;
  totalCentavos: number;
};

export function computeFare(input: FareInput): FareBreakdown {
  const vatRate = input.vatRate ?? VAT_RATE;
  const fareC = toCentavos(input.farePerPax);
  const discC = toCentavos(input.discountTotal ?? 0);
  const grossC = fareC * input.pax;
  const totalC = Math.max(0, grossC - discC);
  // VAT-inclusive split, rounded to centavo (same as SQL round(total/1.12,2))
  const netC = Math.round(totalC / (1 + vatRate));
  const vatC = totalC - netC;
  return {
    farePerPax: input.farePerPax,
    pax: input.pax,
    gross: fromCentavos(grossC),
    discount: fromCentavos(discC),
    total: fromCentavos(totalC),
    net: fromCentavos(netC),
    vatRate,
    vat: fromCentavos(vatC),
    totalCentavos: totalC,
  };
}

// Remaining balance helper for partial payments (if ever enabled).
export function remainingBalance(total: number, paidSoFar: number): number {
  return Math.max(0, Math.round((total - paidSoFar) * 100) / 100);
}
