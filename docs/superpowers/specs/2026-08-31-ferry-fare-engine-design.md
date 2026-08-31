# Ferry Ticketing — Phase 3 Fare Engine Design Spec

**Date:** 2026-08-31
**Phase:** 3 Fare Engine
**Depends on:** Phase 1-2 Foundation + Transportation (ports, routes, vessels, trips, accommodations, auth, GraphQL) — tag `phase1-2-foundation-transport` present, 21 tests PASS, docker 4 services healthy
**Stack:** Python 3.12+ FastAPI Strawberry SQLAlchemy 2.x PostgreSQL Decimal + React TS Vite Tailwind shadcn/ui Apollo
**Status:** Approved

---

## 1. Goal & Scope

Replace stub `Trip.fareFrom = MIN(trip_seats.price)` with production-grade, transparent, auditable fare quoting that supports passenger-type discounts, fees/taxes, vehicle fees, and promo codes — without yet creating bookings/payments.

### In Scope
- Normalized fare domain tables (DB-driven, no hard-coded prices beyond seed)
- Passenger types with statutory discounts
- Fare components (terminal, service, tax, etc.)
- Promotions + applicability rules
- Pure `FareService.calculate(...)` with Decimal math, server-validated, idempotent
- GraphQL `fareQuote`, `passengerTypes`, promotion CRUD (ADMIN), updated `Trip.fareFrom` per accommodation
- Frontend fare breakdown UI on TripDetails with live quoting per passenger type + promo validation
- Seed data for all new tables and transition of existing trip_seats pricing to use new engine

### Out of Scope (Deferred)
- Booking creation, seat holds, payments, ticket generation (Phases 4-6)
- Seasonal dynamic pricing / distance-band tiers (future, guarded by YAGNI)
- Loyalty points, multi-leg fare aggregation (future)
- Vehicle dimension-based pricing beyond simple `vehicleType -> fee` stub (full matrix in Phase 4)

### Success Criteria
- `fareQuote(tripId, accommodationTypeId, passengerType, vehicleType?, promoCode?) -> FareBreakdown` returns 8 Decimal fields with `total = base+accommodation+terminal+service+vehicle - discount + tax`, quantized to `0.01` `ROUND_HALF_UP`, never negative, discount ≤ subtotal
- 6 passenger types, 5 fare components, 3 promos seeded; `alembic upgrade head` clean; `pytest` includes ≥15 fare service tests
- `searchTrips` now returns per-accommodation `fareFrom` via same service; GraphQL `fareQuote` works via `curl` and via frontend
- Frontend TripDetails shows breakdown card (desktop right panel, mobile accordion) and live recalculates on passenger-type change + promo apply; promo errors surface as `INVALID_PROMO` etc.
- RBAC enforced server-side: `fareQuote`/`passengerTypes` public, promotion mutations `ADMIN` only; audit logs on promotion writes

---

## 2. Architecture

### 2.1 Placement

```
GraphQL Resolver (fareQuote) → FareService (pure) → Repositories (fare_rules, components, promotions, passenger_types, trips, accommodations)
                              ↓
                        Decimal utils
```

No business logic in resolvers. Service is stateless, async for DB reads, but calculation itself is synchronous pure function testable without DB.

### 2.2 Approach Selection

- **A: DB-Driven Rule Service (Chosen, Best Practice):** Tables + service. Trade-off analysis in brainstorming; satisfies Spec Rule 4 (no hard-code), Rule 5 (Decimal), Rule 2 (service layer), allows ops to tune prices without deploy. YAGNI-compliant — no caching/season tiers yet.
- B: Minimal hard-coded fees — rejected (tech debt, violates Rule 4)
- C: Dynamic pricing with cache — rejected (needs occupancy signal from Phase 4)

---

## 3. Data Model

### 3.1 Tables (PostgreSQL, additive migration `002_fare_engine`)

```sql
passenger_types: id PK VARCHAR UUID default gen, code UNIQUE VARCHAR(20) (ADULT, CHILD, SENIOR, STUDENT, PWD, INFANT), name VARCHAR(100), description VARCHAR(255) nullable, discount_percent NUMERIC(5,2) CHECK 0-100, requires_id BOOL default false, active BOOL default true, created_at TIMESTAMPTZ, updated_at
  index: (code)

fare_components: id PK, code UNIQUE VARCHAR(30) (TERMINAL_FEE, SERVICE_FEE, VAT, FUEL_SURCHARGE, PORT_FEE), name VARCHAR(100), description VARCHAR(255), amount NUMERIC(10,2) nullable, percent NUMERIC(5,2) nullable CHECK 0-100, is_percent BOOL, active BOOL, created_at, updated_at
  check: (is_percent = true AND percent IS NOT NULL AND amount IS NULL) OR (is_percent=false AND amount IS NOT NULL)

fare_rules: id PK, route_id FK -> routes.id nullable (null = wildcard), vessel_id FK -> vessels.id nullable, accommodation_type_id FK -> accommodation_types.id nullable, passenger_type_id FK -> passenger_types.id nullable, base_fare NUMERIC(10,2) NOT NULL CHECK >=0, active BOOL, valid_from TIMESTAMPTZ nullable, valid_to TIMESTAMPTZ nullable, created_at, updated_at, UNIQUE(route_id, accommodation_type_id, passenger_type_id, vessel_id) with null handling via partial index or coalesce
  indexes: (route_id, accommodation_type_id), (passenger_type_id)

promotions: id PK, code UNIQUE VARCHAR(30) (SUMMER20, SENIOR20 etc), name VARCHAR(100), description VARCHAR(255), discount_type ENUM(PERCENT, FIXED) name promotion_discount_type, discount_value NUMERIC(10,2) CHECK >0, max_uses INT nullable CHECK >0, used_count INT default 0 CHECK >=0, active BOOL, valid_from TIMESTAMPTZ, valid_to TIMESTAMPTZ, min_passengers INT default 1, applicable_scope JSONB nullable (alternative to promotion_rules for simple), created_at, updated_at
  indexes: (code), (active, valid_from, valid_to)

promotion_rules: id PK, promotion_id FK -> promotions.id CASCADE, route_id FK nullable, accommodation_type_id FK nullable, passenger_type_id FK nullable, created_at
  index: (promotion_id)

vehicle_fare_rules: id PK, vehicle_type VARCHAR(30) (MOTORCYCLE, SEDAN, SUV, VAN, PICKUP, TRUCK), base_fee NUMERIC(10,2), per_meter_fee NUMERIC(10,2) nullable, active BOOL
```

Enums: `PromotionDiscountType(PERCENT, FIXED)`

Notes:
- `fare_rules` wildcard null allows fallback: specific route+accommodation+passenger wins, else route+accommodation, else accommodation alone, else global.
- `fare_components` seeded as: TERMINAL_FEE 30 fixed, SERVICE_FEE 50 fixed, VAT 12% percent on (subtotal - discount), FUEL_SURCHARGE 0 fixed (placeholder), PORT_FEE 15 fixed.
- All money `NUMERIC(10,2)` percent `NUMERIC(5,2)` use `utils/decimals.quantize_price`.

### 3.2 Seed

- Passenger types: ADULT 0% (requires_id false), CHILD 20% (requires birth_date), SENIOR 20% (requires_id true, PH statutory), PWD 20% (requires_id), STUDENT 15% (requires_id), INFANT 90% (age <2)
- Fare components: as above
- Fare rules: for each route (4) x accommodation (6) x passenger (6) = 144 rows with `base_fare = accommodation.base_price + route_surcharge - passenger_discount_seed`? Instead simpler: base_fare = accommodation.base_price + route_surcharge where route_surcharge MNL-CEB 300, MNL-ILO 250, MNL-BCD 270, CEB-CGY 150. Discount applied at calculation time, not stored.
- Promotions: SUMMER20 percent 20% max_uses 100 valid 2026-06-01 to 2026-09-30, WELCOME50 fixed 50 max 500, SENIORPLUS percent 10 additional for senior (stack check)
- Vehicle fares: MOTORCYCLE 500, SEDAN 1200, SUV 1400, VAN 1800, PICKUP 1600, TRUCK 3000

---

## 4. Domain Logic — FareService

**Location:** `backend/app/services/fare_service.py`

**Signature:**
```python
from decimal import Decimal
from dataclasses import dataclass

@dataclass(frozen=True)
class FareBreakdown:
    base_fare: Decimal
    accommodation_fee: Decimal
    terminal_fee: Decimal
    service_fee: Decimal
    tax: Decimal
    discount: Decimal
    vehicle_fee: Decimal
    total: Decimal

async def calculate_fare(
    db: AsyncSession,
    trip_id: str,
    accommodation_type_id: str,
    passenger_type_code: str,
    vehicle_type: str | None = None,
    promo_code: str | None = None,
) -> FareBreakdown: ...

async def quote_fare_for_trip_accommodation(...) -> Decimal:  # minimal fareFrom
```

**Algorithm (all Decimal, quantized per step):**
```
1. Load trip with route, vessel; accommodation; passenger_type; fare_rule (most specific); components; promo if code provided; vehicle rule if type.
   - Validate trip exists else TRIP_NOT_FOUND; accommodation exists else INVALID_ACCOMMODATION; passenger_type valid else INVALID_PASSENGER.
2. base_fare = fare_rule.base_fare if found else accommodation.base_price + route_surcharge_fallback
   quantize 0.01
3. accommodation_fee = 0 (if base_fare already includes accommodation) OR lookup delta — for this phase keep 0, keep field for future suite premium, ensures breakdown sums correctly.
4. terminal_fee = fare_components TERMINAL_FEE amount (30) if active else 0
5. service_fee = SERVICE_FEE amount (50)
6. vehicle_fee = vehicle_fare_rules amount for vehicle_type or 0 if None; validate vehicle_type enum else INVALID_VEHICLE
7. subtotal = base_fare + accommodation_fee + terminal_fee + service_fee + vehicle_fee
8. passenger_discount = base_fare * (passenger_type.discount_percent / 100)
   quantize
9. promo_discount = 0
   if promo_code:
     load promotion active, valid_from <= now <= valid_to, used_count < max_uses, route/accommodation applicability via promotion_rules (if rules exist, must match)
     else raise INVALID_PROMO / PROMO_EXPIRED / PROMO_USAGE_EXCEEDED
     if discount_type PERCENT: promo_discount = (subtotal - passenger_discount) * (discount_value/100)
     else FIXED: promo_discount = discount_value
     clamp promo_discount <= (subtotal - passenger_discount)
     # do not increment used_count here (booking phase does)
10. discount = passenger_discount + promo_discount, quantized, clamp <= subtotal
11. taxable = subtotal - discount
12. tax = 0
    for component where is_percent and code VAT: tax += taxable * (percent/100)
    fixed tax components added similarly
    quantize
13. total = taxable + tax, max(total, 0.00), quantize
14. return FareBreakdown(..., quantized)
```

**Invariants:** No float, Decimal only; `quantize_price(..., "0.01")` via `ROUND_HALF_UP`; never negative; discount ≤ subtotal; idempotent; pure aside from DB reads.

**Error codes:** `TRIP_NOT_FOUND`, `INVALID_ACCOMMODATION`, `INVALID_PASSENGER`, `INVALID_VEHICLE`, `INVALID_PROMO`, `PROMO_EXPIRED`, `PROMO_USAGE_EXCEEDED`.

---

## 5. GraphQL

**Scalars:** `Decimal` already exists as string.

**Types (`backend/app/graphql/types/fare.py`):**
```python
@strawberry.type
class FareBreakdownType:
    baseFare: DecimalScalar
    accommodationFee: DecimalScalar
    terminalFee: DecimalScalar
    serviceFee: DecimalScalar
    tax: DecimalScalar
    discount: DecimalScalar
    vehicleFee: DecimalScalar
    total: DecimalScalar

@strawberry.type
class PassengerTypeType: code, name, description, discountPercent: Decimal, requiresId, active

@strawberry.type
class PromotionType: code, name, discountType: str, discountValue: Decimal, maxUses, usedCount, active, validFrom, validTo
```

**Queries (`backend/app/graphql/queries/fare.py`):**
```graphql
passengerTypes: [PassengerType!]!
fareQuote(
  tripId: ID!
  accommodationTypeId: ID!
  passengerType: String!  # code ADULT etc
  vehicleType: String
  promoCode: String
): FareBreakdown!

# existing Trip.fareFrom now resolves via FareService (most cheapest accommodation ADULT no promo) or per-accommodation field fareFromAccommodation
```

**Mutations (`backend/app/graphql/mutations/promotion.py`):**
```graphql
createPromotion(input: CreatePromotionInput!): Promotion! @auth(ADMIN)
updatePromotion(id: ID!, input: UpdatePromotionInput!): Promotion! @auth(ADMIN)
validatePromo(promoCode: String!, tripId: ID): Promotion!  # checks validity, returns promo or error
```

Permissions: `fareQuote` public (no IsAuthenticated), `passengerTypes` public, promotion CRUD `HasRole(ADMIN)` + `IsAuthenticated`.

**Resolver layer:** Thin, calls `FareService` or `PromotionService`; catches ValueError and maps to `GraphQLError` with `extensions.code`.

---

## 6. Frontend

**Queries (`frontend/src/graphql/queries/fare.ts`):**
```graphql
query FareQuote($tripId: ID!, $accommodationTypeId: ID!, $passengerType: String!, $promoCode: String) { fareQuote(...) { baseFare ... total } }
query PassengerTypes { passengerTypes { code name discountPercent } }
```

**Components:**
- `TripDetails` page: fetch `trip` + `accommodationTypes` + `passengerTypes`. Default passenger ADULT, no promo. Show fare breakdown card:
  ```
  Base Fare            ₱1,400.00
  Accommodation          ₱0.00
  Terminal Fee            ₱30.00
  Service Fee             ₱50.00
  Vehicle Fee              ₱0.00
  Discount               -₱0.00
  Tax (12%)              ₱177.60
  ------------------------------
  TOTAL                  ₱1,657.60   (large bold)
  ```
  Uses shadcn `Card`, `Badge` for discount, `Separator`. Desktop: `grid-cols-3` with breakdown sticky right. Mobile: accordion `Sheet`.

- Passenger type selector: `Select` with 6 options, shows discount badge (`-20%`), triggers `fareQuote` on change (debounce 0). Validation via Zod `passengerType` enum.

- Promo row: `Input` + `Button Apply`, calls `fareQuote` with `promoCode`, shows success `-₱200.00` or error `INVALID_PROMO` via `Toast`.

- `searchTrips` enhancement: optionally show cheapest `fareFrom` per trip already via backend update; frontend just displays `From ₱{fareFrom}`.

- `src/components/fare/FareBreakdownCard.tsx` reusable, props `FareBreakdown`, pure display; `src/lib/fare.ts` formatting helper `formatPHP(Decimal)`.

GraphQL client already supports `VITE_GRAPHQL_URL`.

---

## 7. Testing & Verification

- **Unit** `backend/tests/test_fare_service.py` (≥15):
  - Adult no promo → total = base+fees+tax
  - Child 20% discount applied only to base
  - Senior/PWD discount
  - Infant 90% off
  - Vehicle fee added before discount, tax after
  - Percent promo on subtotal-discount
  - Fixed promo clamped to subtotal
  - Invalid promo, expired, usage exceeded, route mismatch
  - Decimal quantization `ROUND_HALF_UP` (e.g., 1.005 → 1.01)
  - Never negative total
- **Integration** `backend/tests/test_fare_graphql.py`:
  - `fareQuote` via `schema.execute` with sqlite DB, checks Decimal string serialization
  - PROMO errors map to GraphQLError codes
  - `passengerTypes` public, `createPromotion` requires ADMIN (401/403)
- **Frontend** `src/components/fare/FareBreakdownCard.test.tsx` (optional Vitest) + manual
- **Verification:** `pytest -v` 36+ tests pass, `curl` fareQuote shows breakdown, frontend live quote changes on passenger type, `docker compose up` healthy

---

## 8. Security & Audit

- All money Decimal, Never float
- Pydantic `condecimal` validation on inputs; Zod on frontend; server never trusts frontend total
- Promo validation server-side only; `used_count` not incremented in quote (booking phase does with `SELECT FOR UPDATE`)
- Rate limiting scaffold via Redis later
- Audit logs on `createPromotion`/`updatePromotion` with user_id, old/new values

---

## 9. Risks & Mitigations

- Risk: Existing trip_seats pricing diverged from new rules → Mitigation: migration backfills `fare_rules` from current accommodation base_price+route surcharge; trip_seats keep price for inventory but `fareFrom` now via service.
- Risk: Decimal serialization across Strawberry→Apollo → Mitigation: existing `DecimalScalar` as string, frontend parses as string display, no arithmetic on float.
- Risk: Wildcard fare_rules null handling ambiguous → Mitigation: explicit fallback order, test coverage, partial indexes.

---

## 10. Implementation Order (This Cycle)

1. Models + migration `002_fare_engine` (passenger_types, fare_components, fare_rules, promotions, promotion_rules, vehicle_fare_rules)
2. Seed extension (passenger types, components, rules, promos, vehicle fees)
3. FareService (pure calculate, quantize, promo validation)
4. GraphQL types/queries/mutations for fare + promotion + updated Trip fareFrom resolver
5. Frontend fare query + breakdown card + passenger selector + promo UI
6. Tests + verification + docs

**Next Phase:** 4 Booking (seat hold, booking creation, expiration) — will call `FareService` for locked totals.

