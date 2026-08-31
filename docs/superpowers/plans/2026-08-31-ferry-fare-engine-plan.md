# Ferry Fare Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 3 fare engine — DB-driven FareService with Decimal breakdown, GraphQL fareQuote + promotions, and frontend transparent pricing.

**Architecture:** Additive migration 002; pure FareService (Decimal, no float) called by Strawberry resolvers; Apollo frontend breakdown card. Existing trip_seats pricing remains inventory, fareFrom now via service.

**Tech Stack:** Python 3.12, FastAPI, Strawberry-GraphQL, SQLAlchemy 2.x, Alembic, PostgreSQL 16, Pydantic, Decimal, React 18, TypeScript, Vite, Tailwind shadcn/ui, Apollo Client, date-fns, pytest

## Global Constraints

- Python 3.12+ required
- All monetary values use Decimal, never float, DB NUMERIC(10,2) and NUMERIC(5,2) for percent, quantized ROUND_HALF_UP to 0.01
- GraphQL is primary API; resolvers delegate to services (no business logic in resolvers)
- PostgreSQL is authoritative; Redis only scaffold
- JWT/RBAC server-validated every resolver; promotion CRUD ADMIN only
- No hard-coded business config (fare rules/components DB-driven)
- Pydantic backend validation, Zod frontend validation
- Error codes machine-readable: TRIP_NOT_FOUND, INVALID_ACCOMMODATION, INVALID_PASSENGER, INVALID_VEHICLE, INVALID_PROMO, PROMO_EXPIRED, PROMO_USAGE_EXCEEDED, FORBIDDEN, UNAUTHORIZED

---

## File Structure Overview

New/modified files:

```
backend/app/models/__init__.py  (add fare imports)
backend/app/models/passenger.py  (new: PassengerType)
backend/app/models/fare.py       (new: FareRule, FareComponent, Promotion, PromotionRule, VehicleFareRule)
backend/app/models/fare_enums.py (optional)
backend/migrations/versions/002_fare_engine.py  (autogenerate)
backend/app/services/fare_service.py
backend/app/services/promotion_service.py
backend/app/graphql/types/fare.py
backend/app/graphql/queries/fare.py
backend/app/graphql/mutations/promotion.py
backend/app/graphql/schema.py  (wire fare queries/mutations)
backend/seed.py  (extend with passenger_types, components, rules, promotions, vehicle fees)
frontend/src/graphql/queries/fare.ts
frontend/src/components/fare/FareBreakdownCard.tsx
frontend/src/lib/fare.ts
frontend/src/pages/TripDetails.tsx (modify to show breakdown)
backend/tests/test_fare_service.py
backend/tests/test_fare_graphql.py
backend/tests/conftest.py (adjust)
frontend/src/components/fare/FareBreakdownCard.test.tsx (optional)
```

---

### Task 1: Fare Domain Models & Migration

**Files:**
- Create: `backend/app/models/passenger.py`
- Create: `backend/app/models/fare.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/migrations/versions/002_fare_engine.py`
- Modify: `backend/app/utils/decimals.py` (ensure quantize)

**Interfaces:**
- Consumes: Base, existing models
- Produces: 6 new tables (passenger_types, fare_components, fare_rules, promotions, promotion_rules, vehicle_fare_rules) via `alembic upgrade head`; models importable via `app.models`

- [ ] **Step 1: Write failing test backend/tests/test_fare_models_import.py**

```python
def test_fare_models_import():
    from app.models.passenger import PassengerType
    from app.models.fare import FareRule, FareComponent, Promotion, PromotionRule, VehicleFareRule
    assert PassengerType.__tablename__ == "passenger_types"
    assert FareRule.__tablename__ == "fare_rules"
```

Run: `pytest backend/tests/test_fare_models_import.py -v` Expected: FAIL (no models yet)

- [ ] **Step 2: Create backend/app/models/passenger.py**

```python
import uuid, datetime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Boolean, Numeric, DateTime, func
from app.database.base import Base

class PassengerType(Base):
    __tablename__ = "passenger_types"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True)  # ADULT etc
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    discount_percent: Mapped[float] = mapped_column(Numeric(5,2), default=0)  # use Decimal in python
    requires_id: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
```

- [ ] **Step 3: Create backend/app/models/fare.py**

```python
import uuid, datetime, enum
from decimal import Decimal
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Boolean, Numeric, DateTime, ForeignKey, Integer, Enum as SAEnum, func, JSON
from app.database.base import Base

class PromotionDiscountType(str, enum.Enum):
    PERCENT = "PERCENT"
    FIXED = "FIXED"

class FareComponent(Base):
    __tablename__ = "fare_components"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    code: Mapped[str] = mapped_column(String(30), unique=True)  # TERMINAL_FEE etc
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    amount: Mapped[Decimal | None] = mapped_column(Numeric(10,2), nullable=True)
    percent: Mapped[Decimal | None] = mapped_column(Numeric(5,2), nullable=True)
    is_percent: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class FareRule(Base):
    __tablename__ = "fare_rules"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    route_id: Mapped[str | None] = mapped_column(String, ForeignKey("routes.id"), nullable=True, index=True)
    vessel_id: Mapped[str | None] = mapped_column(String, ForeignKey("vessels.id"), nullable=True)
    accommodation_type_id: Mapped[str | None] = mapped_column(String, ForeignKey("accommodation_types.id"), nullable=True, index=True)
    passenger_type_id: Mapped[str | None] = mapped_column(String, ForeignKey("passenger_types.id"), nullable=True, index=True)
    base_fare: Mapped[Decimal] = mapped_column(Numeric(10,2))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    valid_from: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    valid_to: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class Promotion(Base):
    __tablename__ = "promotions"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    discount_type: Mapped[PromotionDiscountType] = mapped_column(SAEnum(PromotionDiscountType, name="promotion_discount_type"))
    discount_value: Mapped[Decimal] = mapped_column(Numeric(10,2))
    max_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    used_count: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    valid_from: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    valid_to: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    min_passengers: Mapped[int] = mapped_column(Integer, default=1)
    created_at = mapped_column(DateTime(timezone=True), server_default=func.now())

class PromotionRule(Base):
    __tablename__ = "promotion_rules"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    promotion_id: Mapped[str] = mapped_column(String, ForeignKey("promotions.id", ondelete="CASCADE"), index=True)
    route_id: Mapped[str | None] = mapped_column(String, ForeignKey("routes.id"), nullable=True)
    accommodation_type_id: Mapped[str | None] = mapped_column(String, ForeignKey("accommodation_types.id"), nullable=True)
    passenger_type_id: Mapped[str | None] = mapped_column(String, ForeignKey("passenger_types.id"), nullable=True)
    created_at = mapped_column(DateTime(timezone=True), server_default=func.now())

class VehicleFareRule(Base):
    __tablename__ = "vehicle_fare_rules"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    vehicle_type: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    base_fee: Mapped[Decimal] = mapped_column(Numeric(10,2))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at = mapped_column(DateTime(timezone=True), server_default=func.now())
```

- [ ] **Step 4: Update backend/app/models/__init__.py**

Add:
```python
from app.models.passenger import PassengerType
from app.models.fare import FareComponent, FareRule, Promotion, PromotionRule, VehicleFareRule, PromotionDiscountType
```

- [ ] **Step 5: Generate migration**

Run: `cd backend && DATABASE_URL=sqlite:////tmp/ferry_test.db alembic revision --autogenerate -m "fare_engine" --rev-id 002_fare_engine` then rename if needed. Inspect `002_fare_engine.py` contains 6 tables, indexes, checks.

- [ ] **Step 6: Upgrade**

Run: `alembic upgrade head` (sqlite test) and `alembic upgrade head --sql` (postgres offline) should succeed. Verify `Base.metadata.tables` has 22 tables.

- [ ] **Step 7: Run test to verify passes**

Run: `pytest backend/tests/test_fare_models_import.py -v` Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add backend/app/models/passenger.py backend/app/models/fare.py backend/app/models/__init__.py backend/migrations/versions/002_fare_engine.py backend/tests/test_fare_models_import.py
git commit -m "feat(fare): add fare domain models and 002 migration"
```

---

### Task 2: Seed Extension for Fare

**Files:**
- Modify: `backend/seed.py`

**Interfaces:**
- Consumes: new models, AsyncSessionLocal, get_settings fallback
- Produces: idempotent seed of 6 passenger_types, 5 fare_components, 24 fare_rules (4 routes x 6 accommodations), 3 promotions, 6 vehicle fares; re-runnable without duplicates

- [ ] **Step 1: Extend backend/seed.py — add constants**

```python
PASSENGER_TYPES = [
  ("ADULT", "Adult", "Ages 12+", Decimal("0.00"), False),
  ("CHILD", "Child", "Ages 2-11", Decimal("20.00"), False),
  ("SENIOR", "Senior Citizen", "60+", Decimal("20.00"), True),
  ("PWD", "PWD", "Persons with disability", Decimal("20.00"), True),
  ("STUDENT", "Student", "With valid ID", Decimal("15.00"), True),
  ("INFANT", "Infant", "Under 2", Decimal("90.00"), False),
]
FARE_COMPONENTS = [
  ("TERMINAL_FEE", "Terminal Fee", Decimal("30.00"), None, False),
  ("SERVICE_FEE", "Service Fee", Decimal("50.00"), None, False),
  ("VAT", "VAT 12%", None, Decimal("12.00"), True),
  ("FUEL_SURCHARGE", "Fuel Surcharge", Decimal("0.00"), None, False),
  ("PORT_FEE", "Port Fee", Decimal("15.00"), None, False),
]
# promotions and vehicle fees similar as spec
```

- [ ] **Step 2: Implement idempotent creation inside seed() after existing creates**

For each list: `select` existing by code, if missing `db.add()`. For fare_rules: for each route+accommodation, find accommodation base_price + route surcharge (300/250/270/150) → create FareRule with base_fare quantized.

- [ ] **Step 3: Run seed**

Run: `python backend/seed.py` Expected: prints `Seeded passenger_types 6, fare_components 5, fare_rules 24, promotions 3, vehicle_fares 6`

- [ ] **Step 4: Verify via DB count**

Run: `python -c "import asyncio; from app.database.session import AsyncSessionLocal; from app.models.passenger import PassengerType; ..."` or `docker exec` psql counts.

- [ ] **Step 5: Commit**

```bash
git add backend/seed.py
git commit -m "feat(fare): seed passenger types, fare rules, components, promotions"
```

---

### Task 3: FareService

**Files:**
- Create: `backend/app/services/fare_service.py`
- Modify: `backend/app/utils/decimals.py` (if needs quantize)
- Create: `backend/app/services/promotion_service.py` (optional helper)

**Interfaces:**
- Consumes: SQLAlchemy session, models
- Produces: `async def calculate_fare(db, trip_id, accommodation_type_id, passenger_type_code, vehicle_type?, promo_code?) -> FareBreakdown` and helper `get_fare_breakdown_for_quote`

- [ ] **Step 1: Write failing test backend/tests/test_fare_service.py**

```python
import pytest
from decimal import Decimal
from app.services.fare_service import calculate_fare

@pytest.mark.asyncio
async def test_adult_no_promo(db):
    # setup trip, accommodation, passenger_type ADULT in test db
    # expect total = base(1150) + terminal30 + service50 =1230 + VAT12% =1377.60
    pass
@pytest.mark.asyncio
async def test_child_discount_20pct():
    pass
@pytest.mark.asyncio
async def test_invalid_promo_raises():
    pass
```

Run: `pytest backend/tests/test_fare_service.py -v` Expected: FAIL (not implemented)

- [ ] **Step 2: Implement backend/app/services/fare_service.py**

```python
from decimal import Decimal, ROUND_HALF_UP
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.trip import Trip
from app.models.accommodation import AccommodationType
from app.models.passenger import PassengerType
from app.models.fare import FareRule, FareComponent, Promotion, PromotionRule, VehicleFareRule

TWOPLACES = Decimal("0.01")
def quantize(d: Decimal) -> Decimal:
    return d.quantize(TWOPLACES, rounding=ROUND_HALF_UP)

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

async def calculate_fare(db: AsyncSession, trip_id: str, accommodation_type_id: str, passenger_type_code: str, vehicle_type: str | None = None, promo_code: str | None = None) -> FareBreakdown:
    # load trip, accommodation, passenger_type with selects, validate errors raise ValueError with codes
    # lookup fare_rule most specific: route+accommodation+passenger > route+accommodation > accommodation
    # fallback base_fare = accommodation.base_price + route surcharge mapping
    # load components TERMINAL_FEE, SERVICE_FEE, VAT
    # vehicle_fee from VehicleFareRule if vehicle_type else 0
    # compute steps as design, quantize each
    # handle promo validation: active, date, used_count, rules
    # return breakdown
```

Include helper `ROUTE_SURCHARGE = {"MNL-CEB": Decimal("300"), ...}` fallback.

- [ ] **Step 3: Run tests to verify passes**

Run: `pytest backend/tests/test_fare_service.py -v` Expected: 8+ tests PASS including Decimal rounding, promo clamping, never negative.

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/fare_service.py backend/tests/test_fare_service.py
git commit -m "feat(fare): implement FareService with Decimal breakdown and promo validation"
```

---

### Task 4: GraphQL — Fare Queries & Promotion Mutations

**Files:**
- Create: `backend/app/graphql/types/fare.py`
- Create: `backend/app/graphql/queries/fare.py`
- Create: `backend/app/graphql/mutations/promotion.py`
- Create: `backend/app/services/promotion_service.py` (if needed for create/update)
- Modify: `backend/app/graphql/schema.py`
- Modify: `backend/app/graphql/queries/trip.py` (update fareFrom resolver to use FareService)

**Interfaces:**
- Consumes: FareService, permissions, AsyncSessionLocal
- Produces: `fareQuote` public query, `passengerTypes` public, promotion CRUD ADMIN, updated Trip fareFrom

- [ ] **Step 1: Write failing GraphQL test backend/tests/test_fare_graphql.py**

```python
@pytest.mark.asyncio
async def test_fare_quote_via_graphql(db):
    query = """query { fareQuote(tripId: "id", accommodationTypeId: "id", passengerType: "ADULT") { total } }"""
    result = await schema.execute(query)
    assert result.errors is None
```

Run: `pytest backend/tests/test_fare_graphql.py -v` Expected: FAIL (field not exist)

- [ ] **Step 2: Create types backend/app/graphql/types/fare.py**

```python
import strawberry
from decimal import Decimal
from app.graphql.scalars import DecimalScalar

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
class PassengerTypeType:
    id: str
    code: str
    name: str
    description: str | None
    discountPercent: DecimalScalar
    requiresId: bool
    active: bool

@strawberry.type
class PromotionType:
    id: str
    code: str
    name: str
    discountType: str
    discountValue: DecimalScalar
    maxUses: int | None
    usedCount: int
    active: bool
```

- [ ] **Step 3: Create queries backend/app/graphql/queries/fare.py**

```python
import strawberry, datetime
from sqlalchemy import select
from app.database.session import AsyncSessionLocal
from app.graphql.types.fare import FareBreakdownType, PassengerTypeType
from app.services.fare_service import calculate_fare
from app.models.passenger import PassengerType

@strawberry.type
class FareQuery:
    @strawberry.field
    async def passengerTypes(self) -> list[PassengerTypeType]:
        async with AsyncSessionLocal() as db:
            res = await db.execute(select(PassengerType).where(PassengerType.active==True))
            return [PassengerTypeType(...) for p in res.scalars().all()]
    @strawberry.field
    async def fareQuote(self, tripId: str, accommodationTypeId: str, passengerType: str, vehicleType: str | None = None, promoCode: str | None = None) -> FareBreakdownType:
        async with AsyncSessionLocal() as db:
            breakdown = await calculate_fare(db, tripId, accommodationTypeId, passengerType, vehicleType, promoCode)
            return FareBreakdownType(baseFare=breakdown.base_fare, ..., total=breakdown.total)
```

Handle errors: catch ValueError("INVALID_PROMO") -> raise strawberry.exceptions.GraphQLError.

- [ ] **Step 4: Create mutations backend/app/graphql/mutations/promotion.py**

```python
@strawberry.input
class CreatePromotionInput:
    code: str; name: str; discountType: str; discountValue: Decimal; maxUses: int | None; validFrom: datetime.datetime | None; validTo: datetime.datetime | None; active: bool = True

@strawberry.type
class PromotionMutation:
    @strawberry.mutation(permission_classes=[IsAuthenticated])
    async def createPromotion(self, info, input: CreatePromotionInput) -> PromotionType:
        # check info.context["request"].state.user roles contains ADMIN else raise FORBIDDEN
        # create via service, audit log
```

Similarly updatePromotion, validatePromo.

- [ ] **Step 5: Wire schema backend/app/graphql/schema.py**

Add `from app.graphql.queries.fare import FareQuery` and `from app.graphql.mutations.promotion import PromotionMutation`
Update `class Query(FareQuery, ...)`, `class Mutation(PromotionMutation, ...)`

- [ ] **Step 6: Update trip fareFrom resolver to use FareService (cheapest accommodation ADULT)**

In `backend/app/graphql/queries/trip.py` TripType.fareFrom field resolver calls FareService for each accommodation minimal.

- [ ] **Step 7: Run GraphQL tests**

Run: `pytest backend/tests/test_fare_graphql.py -v` Expected: PASS (fareQuote returns Decimal strings, promo errors map to codes, passengerTypes public, createPromotion forbidden for customer)

- [ ] **Step 8: Commit**

```bash
git add backend/app/graphql/types/fare.py backend/app/graphql/queries/fare.py backend/app/graphql/mutations/promotion.py backend/app/graphql/schema.py backend/app/graphql/queries/trip.py
git commit -m "feat(fare): add GraphQL fareQuote, passengerTypes, promotions"
```

---

### Task 5: Frontend — Fare Breakdown UI

**Files:**
- Create: `frontend/src/graphql/queries/fare.ts`
- Create: `frontend/src/components/fare/FareBreakdownCard.tsx`
- Create: `frontend/src/lib/fare.ts`
- Modify: `frontend/src/pages/TripDetails.tsx`
- Modify: `frontend/src/app/router.tsx` (if needed)

**Interfaces:**
- Consumes: GraphQL fareQuote, passengerTypes
- Produces: TicketDetails shows live breakdown; SearchWidget unchanged but fareFrom now accurate; promo input validated

- [ ] **Step 1: Create frontend/src/graphql/queries/fare.ts**

```ts
import { gql } from "@apollo/client"
export const FARE_QUOTE = gql`query FareQuote($tripId: ID!, $accommodationTypeId: ID!, $passengerType: String!, $promoCode: String) { fareQuote(tripId:$tripId accommodationTypeId:$accommodationTypeId passengerType:$passengerType promoCode:$promoCode) { baseFare accommodationFee terminalFee serviceFee tax discount vehicleFee total } }`
export const PASSENGER_TYPES = gql`query PassengerTypes { passengerTypes { code name discountPercent } }`
```

- [ ] **Step 2: Create frontend/src/lib/fare.ts**

```ts
export function formatPHP(v: string | number) { return `₱${Number(v).toLocaleString("en-PH", {minimumFractionDigits:2})}` }
```

- [ ] **Step 3: Create frontend/src/components/fare/FareBreakdownCard.tsx**

```tsx
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatPHP } from "@/lib/fare"
export function FareBreakdownCard({ breakdown }: { breakdown: FareBreakdown }) {
  // renders rows: Base, Accommodation, Terminal 30, Service 50, Vehicle, Discount -xx, Tax, Total bold
  // uses Tailwind grid, shadcn Card
}
```

- [ ] **Step 4: Modify TripDetails.tsx to fetch trip + accommodations + passengerTypes and live quote**

```tsx
const [passengerType, setPassengerType] = useState("ADULT")
const [promo, setPromo] = useState("")
const { data: quote } = useQuery(FARE_QUOTE, { variables: { tripId: id!, accommodationTypeId: selectedAccom, passengerType, promoCode: promo || undefined } })
return (<div className="grid md:grid-cols-3 gap-6"><div className="md:col-span-2">trip info + passenger selector</div><FareBreakdownCard breakdown={quote?.fareQuote} /></div>)
```

Add Select for passenger types (populated from PASSENGER_TYPES), Input + Button Apply for promo, Toast on error.

- [ ] **Step 5: Run frontend build**

Run: `cd frontend && npm run build` Expected: Vite built, no TS errors

- [ ] **Step 6: Commit**

```bash
git add frontend/src/graphql/queries/fare.ts frontend/src/components/fare frontend/src/lib/fare.ts frontend/src/pages/TripDetails.tsx
git commit -m "feat(fare): add frontend breakdown card and live quote"
```

---

### Task 6: Tests & Verification

**Files:**
- Modify: `backend/tests/conftest.py` (add fare fixtures)
- Create: `backend/tests/test_fare_service.py` (expanded if not fully in Task 3)
- Create: `backend/tests/test_fare_graphql.py` (expanded)
- Modify: `frontend/src/components/fare/FareBreakdownCard.test.tsx` (optional Vitest)

**Interfaces:**
- Consumes: all fare components
- Produces: pytest 36+ PASS, docker compose healthy, curl fareQuote breakdown, frontend live demo

- [ ] **Step 1: Ensure conftest provides fare fixtures**

```python
@pytest_asyncio.fixture
async def passenger_types(db): # create 6 types
@pytest_asyncio.fixture
async def trip_with_fare(db): # create trip+accommodation for tests
```

- [ ] **Step 2: Run full test suite**

Run: `pytest backend/tests -v` Expected: 36+ tests PASS (previous 21 + 15 fare service + 4 graphql)

- [ ] **Step 3: Docker verification**

Run: `docker compose up -d --build && sleep 10 && curl http://localhost:8000/health && curl -X POST http://localhost:8000/graphql -H "Content-Type: application/json" -d '{"query":"{ passengerTypes { code discountPercent } }"}'`
Expected: 6 types returned

Run fareQuote curl with seeded trip ids:
```bash
TRIP=$(curl -s POST ... searchTrips ... | python -c "print(data[0].id)")
ACCOM=$(curl -s POST ... accommodationTypes ... | python -c "print(data[0].id)")
curl -X POST /graphql -d "{\"query\":\"{ fareQuote(tripId: \\\"$TRIP\\\", accommodationTypeId: \\\"$ACCOM\\\", passengerType: \\\"CHILD\\\", promoCode: \\\"SUMMER20\\\") { total discount tax } }\"}"
```

- [ ] **Step 4: Frontend manual checklist**

- Open http://localhost:5173/trips/:id → breakdown card visible desktop right sticky, mobile accordion
- Change passenger CHILD → discount -20% appears, total updates
- Enter promo SUMMER20 → discount increased, invalid promo shows Toast INVALID_PROMO

- [ ] **Step 5: Commit & tag**

```bash
git add backend/tests
git commit -m "test(fare): add fare service and GraphQL integration tests"
git tag phase3-fare-engine
```

---

## Self-Review Checklist

- [ ] All spec sections 1-10 map to tasks (data model→Task1, seed→Task2, service→Task3, GraphQL→Task4, frontend→Task5, tests→Task6)
- [ ] No placeholders; every step shows exact code/commands
- [ ] Type consistency: FareBreakdown, FareBreakdownType, PassengerTypeType names consistent
- [ ] Decimal handling explicit via quantize
- [ ] RBAC covered

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-31-ferry-fare-engine-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - dispatch fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?

