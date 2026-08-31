# Ferry Ticketing & Booking Platform — Phase 1-2 Design Spec

**Date:** 2026-08-30
**Phase:** 1 Foundation + 2 Transportation
**Stack:** Python 3.12+ FastAPI Strawberry GraphQL SQLAlchemy 2.x PostgreSQL Redis React TS Vite Tailwind shadcn/ui
**Auth:** JWT (access+refresh) + bcrypt/argon2, RBAC
**Payment:** Mock provider behind abstraction (Phase 1-2 stub)
**Status:** Approved

---

## 1. Goal & Scope

Build the foundational production-grade ferry booking platform incrementally, starting with infrastructure, auth, and core transportation domain. This spec covers **Phase 1 (Foundation)** and **Phase 2 (Transportation)** only, to keep implementation focused and verifiable.

### In Scope (Phase 1-2)

- Repo structure, Docker, env management
- PostgreSQL + Redis + Alembic
- FastAPI app lifecycle, middleware, health checks
- Strawberry GraphQL endpoint (primary API) + REST for health/webhooks/uploads
- Auth: registration, login, JWT, refresh, RBAC (CUSTOMER, ADMIN, OPERATIONS, TICKETING_AGENT, FINANCE, SUPPORT)
- Users, Roles
- Ports, Routes (with route_stops for future multi-leg), Vessels, Accommodations, Trips, Trip Inventory (seats/vehicle slots)
- Seed data: 8 PH ports, 4 routes, 3 vessels, 6 accommodation types, sample trips
- Frontend shell: Vite+React+TS+Tailwind+shadcn/ui + Apollo, pages: `/`, `/search`, `/trips`, `/trips/:id`
- Search widget (From, To, Departure Date, Passengers) and trip result cards (vessel, departure/arrival, duration, price from fare stub)
- Decimal money, audit logging scaffold, error codes

### Out of Scope (Deferred to Phase 3+)

- Full fare engine (Phase 3), booking/seat-hold/payments/tickets/check-in/boarding (Phases 4-7), admin ops dashboards, reports, notifications, refunds

### Success Criteria

- `docker compose up` brings backend, frontend, postgres, redis healthy
- GraphQL queries: `ports`, `routes`, `vessels`, `searchTrips`, `trip(id)`, `accommodationTypes`; mutations: `register`, `login`, `refreshToken`
- DB migrations run cleanly; seed creates ports/routes/vessels/trips
- Frontend search widget queries GraphQL and displays trip results responsively
- Auth protects GraphQL resolvers server-side; unauthorized returns `UNAUTHORIZED`/`FORBIDDEN`
- Concurrency-safe inventory design (trip_seats with unique constraints, status enums) ready for Phase 4 seat holds

---

## 2. Architecture

### 2.1 High-Level

```
Browser (React + Apollo)
   ↓ GraphQL (POST /graphql)
FastAPI (auth middleware, GraphQL, REST /health, /webhooks)
   ↓ SQLAlchemy 2.x + Alembic
PostgreSQL (authoritative)
   ↓ Redis (cache/hold expiration/rate limit in Phase 4+)
Celery/Background (Phase 5+; scaffold now)
```

**Choice: Monolithic Modular FastAPI** (Approach A) — single service with bounded modules. Trade-off analysis:

- **A: Modular Monolith (Chosen):** Simple dev, strong transactional guarantees (`SELECT FOR UPDATE`), easy Docker, aligns with spec's `backend/app/modules/*`. Scales vertically to high throughput; can extract services later behind same GraphQL.
- **B: Microservices:** Overkill for Phase 1-2; distributed transactions harm booking safety; extra ops complexity.
- **C: REST-first + GraphQL later:** Diverges from spec (GraphQL primary); double work.

### 2.2 Repo Layout

```
ticketing/
├── docker-compose.yml
├── .env.example
├── docs/superpowers/specs/
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── config/settings.py
│   │   ├── database/{base.py, session.py}
│   │   ├── middleware/{auth.py, cors.py}
│   │   ├── models/{user.py, port.py, route.py, vessel.py, trip.py, accommodation.py, audit.py}
│   │   ├── repositories/
│   │   ├── services/{auth_service.py, port_service.py, ...}
│   │   ├── graphql/{schema.py, types/, queries/, mutations/, inputs/, enums/, scalars.py}
│   │   ├── modules/{auth/, users/, ports/, routes/, vessels/, trips/, accommodations/}
│   │   └── utils/{security.py, decimals.py, references.py}
│   ├── migrations/
│   ├── tests/
│   ├── pyproject.toml (or requirements.txt)
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── app/{router.tsx, App.tsx}
│   │   ├── components/{ui/, booking/, trips/, layout/}
│   │   ├── graphql/{queries/, mutations/, client.ts}
│   │   ├── pages/{Home.tsx, Search.tsx, Trips.tsx, TripDetails.tsx}
│   │   ├── lib/{utils.ts}
│   │   └── types/
│   ├── index.html
│   ├── tailwind.config.js
│   ├── vite.config.ts
│   └── Dockerfile
```

---

## 3. Data Model

### 3.1 Auth

```
users: id PK, email UNIQUE, password_hash, first_name, last_name, is_active, created_at, updated_at
roles: id PK, code UNIQUE, name, description
user_roles: user_id FK, role_id FK, PK(user_id, role_id)
audit_logs: id PK, user_id FK, action, entity_type, entity_id, old_value JSONB, new_value JSONB, ip_address, user_agent, created_at
```

### 3.2 Ports & Routes

```
ports: id PK, code UNIQUE (e.g., MNL), name, city, province, country DEFAULT 'Philippines', address, latitude DECIMAL, longitude DECIMAL, timezone DEFAULT 'Asia/Manila', active BOOL, created_at, updated_at
routes: id PK, code UNIQUE, origin_port_id FK→ports, destination_port_id FK→ports, distance_km DECIMAL, estimated_duration_minutes INT, active BOOL, created_at, updated_at
route_stops: id PK, route_id FK→routes, port_id FK→ports, stop_order INT, UNIQUE(route_id, stop_order), UNIQUE(route_id, port_id)
  → enables future Manila→Batangas→Cebu→CDO
```

Indexes: `ports(code)`, `routes(origin_port_id, destination_port_id)`, `route_stops(route_id, stop_order)`.

### 3.3 Vessels & Layout

```
vessels: id PK, name, code UNIQUE, registration_number UNIQUE, capacity INT, vehicle_capacity INT, status ENUM(ACTIVE,MAINTENANCE,INACTIVE,RETIRED), active BOOL, created_at, updated_at
accommodation_types: id PK, code UNIQUE, name UNIQUE (Super Value, Mega Value, Tourist, Cabin...), description, capacity INT, base_price DECIMAL(10,2), active BOOL
vessel_decks: id PK, vessel_id FK, name (Deck 1...), deck_order INT
vessel_sections: id PK, deck_id FK, accommodation_type_id FK, name, capacity INT
vessel_seats: id PK, section_id FK, seat_number (A01), status ENUM(AVAILABLE,HELD,RESERVED,OCCUPIED,BLOCKED) DEFAULT AVAILABLE  // template layout
vessel_vehicle_slots: id PK, section_id FK, slot_number, vehicle_type ENUM, status
```

### 3.4 Trips & Inventory (Snapshot per Trip)

```
trips: id PK, route_id FK, vessel_id FK, departure_port_id FK, arrival_port_id FK, departure_at TIMESTAMPTZ, arrival_at TIMESTAMPTZ, status ENUM(SCHEDULED,BOARDING,DEPARTED,ARRIVED,CANCELLED,DELAYED,COMPLETED) DEFAULT SCHEDULED, booking_open TIMESTAMPTZ, booking_close TIMESTAMPTZ, created_at, updated_at
trip_seats: id PK, trip_id FK, vessel_seat_id FK nullable, seat_number, accommodation_type_id FK, status ENUM(AVAILABLE,HELD,RESERVED,OCCUPIED,BLOCKED), hold_expires_at TIMESTAMPTZ nullable, booking_id FK nullable, price DECIMAL(10,2), UNIQUE(trip_id, seat_number), INDEX(trip_id, status, accommodation_type_id)
trip_vehicle_slots: id PK, trip_id FK, slot_number, vehicle_type, status, price DECIMAL
```

**Concurrency safety:** Trip inventory is snapshot at trip creation. Phase 4 will use `SELECT FOR UPDATE` on `trip_seats` where `status=AVAILABLE` and set to `HELD` with `hold_expires_at`; DB unique constraints prevent double-booking. Redis hold expiration is secondary; PG is authoritative.

### 3.5 Money

All `DECIMAL(10,2)` or `DECIMAL(12,2)` for totals; Pydantic `Decimal` validation; never float.

---

## 4. GraphQL Design (Strawberry)

### 4.1 Scalars & Enums

- Scalars: `DateTime`, `Decimal`, `JSON`
- Enums: `VesselStatus`, `TripStatus`, `SeatStatus`, `UserRole`, `BookingStatus` (stub for now), `PaymentStatus` (stub)

### 4.2 Types (Phase 1-2)

```
Port, Route, RouteStop, Vessel, VesselDeck, VesselSection, AccommodationType, Trip, TripSeat, User, AuthPayload
```

### 4.3 Queries

```
ports(active: Boolean): [Port!]!
port(id: ID!): Port
routes: [Route!]!
route(id: ID!): Route
vessels: [Vessel!]!
vessel(id: ID!): Vessel
accommodationTypes: [AccommodationType!]!
searchTrips(originPortId: ID!, destinationPortId: ID!, departureDate: Date!, passengers: Int): [Trip!]!
trip(id: ID!): Trip
me: User
```

### 4.4 Mutations

```
register(input: RegisterInput!): AuthPayload!
login(input: LoginInput!): AuthPayload!
refreshToken(refreshToken: String!): AuthPayload!
createPort(input: CreatePortInput!): Port! @auth(ADMIN)
updatePort(id: ID!, input: UpdatePortInput!): Port! @auth(ADMIN)
createRoute(input: CreateRouteInput!): Route! @auth(ADMIN)
createVessel(input: CreateVesselInput!): Vessel! @auth(ADMIN)
createTrip(input: CreateTripInput!): Trip! @auth(ADMIN, OPERATIONS)
```

### 4.5 Resolver Layering

```
GraphQL Resolver → Application Service → Repository → DB
No business logic in resolvers.
```

---

## 5. Auth & Security

- Passwords: `argon2` (via `passlib[argon2]` or `argon2-cffi`) fallback `bcrypt`
- JWT: access 15min, refresh 7d, secrets from env `JWT_SECRET`/`JWT_REFRESH_SECRET`
- Middleware validates Bearer token, injects `request.state.user`
- Strawberry `permission_classes` enforce RBAC per resolver
- CORS configured from env; rate limiting scaffold via Redis
- Error codes: `UNAUTHORIZED`, `FORBIDDEN`, `TRIP_NOT_FOUND`, `VALIDATION_ERROR`
- Audit logs on auth events and admin mutations

---

## 6. Frontend (Phase 1-2)

- Stack: React 18, TS, Vite, Tailwind, shadcn/ui, React Hook Form + Zod, Apollo Client, Lucide, date-fns
- Client: Apollo with `httpLink` to `VITE_GRAPHQL_URL` (`/graphql`), authLink injects JWT from localStorage
- Layout: header, search widget, main, footer; responsive mobile-first
- Pages:
  - `/` Home: hero + `SearchWidget` (From ComboBox, To ComboBox, Departure DatePicker, Passengers Select, [SEARCH TRIPS])
  - `/search` → redirects to `/trips?origin=&destination=&date=&pax=`
  - `/trips`: query `searchTrips`, display `TripCard` list (vessel, departure/arrival, duration, from-price)
  - `/trips/:id`: trip details, accommodation breakdown, vessel info, CTA to login/booking (booking flow stub)
- shadcn components: Button, Card, Select, Calendar, Popover, Command, Badge, Input, Label, Toast
- Validation: Zod schemas for search; Pydantic on backend

---

## 7. Fare Stub (Phase 2)

Phase 1-2 does not implement full fare engine. Provide `Trip.fareFrom: Decimal` derived as `MIN(trip_seats.price WHERE status=AVAILABLE)` or `accommodation_types.base_price` + route surcharge. Frontend displays `From ₱{fareFrom}`. Full `fareQuote` query deferred to Phase 3.

---

## 8. Docker & Env

- Services: `postgres:16-alpine`, `redis:7-alpine`, `backend`, `frontend`
- `docker-compose.yml` with healthchecks, volumes, depends_on
- Env: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CORS_ORIGINS`, `VITE_GRAPHQL_URL`
- `.env.example` without secrets
- Backend Dockerfile: python:3.12-slim, pip, alembic migrate on start
- Frontend Dockerfile: node:20-alpine, vite dev server (Phase 1-2)

---

## 9. Seeding

- Ports: MNL Manila North Harbor, CEB Cebu, ILO Iloilo, BCD Bacolod, CGY Cagayan de Oro, DVO Davao, BTG Batangas, TAG Tagbilaran
- Routes: MNL→CEB, MNL→ILO, MNL→BCD, CEB→CGY
- Vessels: MV St. Francis Xavier, MV St. Therese, MV 2GO Malasakit (capacities 1500/300, decks/sections)
- AccommodationTypes: SV, MV, Tourist, Cabin, Deluxe Cabin, Suite
- Trips: 10+ trips across next 14 days, with trip_seats generated per vessel layout

---

## 10. Testing & Verification (Phase 1-2)

- Backend: pytest, `test_auth` (register/login/refresh/me/RBAC), `test_search_trips`, `test_trip_crud`, concurrency test stub for trip_seats unique constraint
- Frontend: Vitest + Testing Library for SearchWidget, Apollo MockedProvider
- Verification: `docker compose up --build`, `alembic upgrade head`, `pytest`, GraphQL playground queries listed above

---

## 11. Risks & Mitigations

- **Empty repo:** Scaffold from scratch; mitigate via incremental commits and `git init`.
- **GraphQL complexity:** Enforce query depth limits and use DataLoader pattern later.
- **Decimal handling:** Strawberry custom scalar with string serialization; validate on both ends.
- **Concurrency:** Design trip_seats with row-level locks early even if hold logic is Phase 4.

---

## 12. Implementation Order (This Cycle)

1. Repo init + Docker + env
2. Backend scaffolding + config + DB session + Alembic
3. Models + migrations (users, ports, routes, vessels, accommodations, trips)
4. Auth service + GraphQL auth
5. GraphQL schema + queries/mutations for ports/routes/vessels/trips
6. Seed script
7. Frontend scaffolding + Apollo + shadcn + pages
8. Integration verification + tests

**Next Phases:** 3 Fare Engine → 4 Booking → 5 Payment → 6 Ticketing → 7 Operations → 8 Admin → 9 Hardening

