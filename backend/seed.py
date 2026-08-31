import asyncio
import os
import uuid
import random
import datetime
from decimal import Decimal, ROUND_HALF_UP

# Ensure backend dir is in path when run as `python backend/seed.py` vs `python seed.py`
# Already handled by PYTHONPATH, but keep importable
from app.config.settings import get_settings
from app.database.session import AsyncSessionLocal
from app.database.base import Base
from app.models.port import Port
from app.models.route import Route, RouteStop
from app.models.vessel import Vessel, VesselDeck, VesselSection, VesselSeat
from app.models.accommodation import AccommodationType
from app.models.trip import Trip, TripSeat
from app.models.trip import TripStatus, TripSeatStatus
from app.models.user import Role, User
from app.models.passenger import PassengerType
from app.models.fare import FareComponent, FareRule, Promotion, PromotionRule, VehicleFareRule, PromotionDiscountType
from app.utils.security import hash_password
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker


# --- Constants ---
PORTS = [
    ("MNL", "Manila North Harbor", "Manila", "Metro Manila"),
    ("CEB", "Cebu Port", "Cebu City", "Cebu"),
    ("ILO", "Iloilo Port", "Iloilo City", "Iloilo"),
    ("BCD", "Bacolod Port", "Bacolod City", "Negros Occidental"),
    ("CGY", "Cagayan de Oro Port", "Cagayan de Oro", "Misamis Oriental"),
    ("DVO", "Davao Port", "Davao City", "Davao del Sur"),
    ("BTG", "Batangas Port", "Batangas City", "Batangas"),
    ("TAG", "Tagbilaran Port", "Tagbilaran City", "Bohol"),
]

# 6 accommodation types with base_price 850-3500
ACCOMMODATIONS = [
    ("SV", "Super Value", "Budget open seating", 100, Decimal("850.00")),
    ("MV", "Mega Value", "Air-conditioned seating", 80, Decimal("1100.00")),
    ("TOURIST", "Tourist", "Tourist class bunk", 60, Decimal("1500.00")),
    ("CABIN", "Cabin", "Shared cabin 4 pax", 40, Decimal("2000.00")),
    ("DELUXE", "Deluxe Cabin", "Deluxe cabin 2 pax", 20, Decimal("2800.00")),
    ("SUITE", "Suite", "Private suite", 10, Decimal("3500.00")),
]

VESSELS = [
    ("SFX", "MV St. Francis Xavier", "REG-SFX-001", 1000, 50),
    ("STH", "MV St. Therese", "REG-STH-002", 1000, 50),
    ("MAL", "MV 2GO Malasakit", "REG-MAL-003", 1200, 60),
]

ROUTES = [
    # code, origin_code, dest_code, distance_km, duration mins
    ("MNL-CEB", "MNL", "CEB", Decimal("500.00"), 720),
    ("MNL-ILO", "MNL", "ILO", Decimal("400.00"), 720),
    ("MNL-BCD", "MNL", "BCD", Decimal("450.00"), 720),
    ("CEB-CGY", "CEB", "CGY", Decimal("200.00"), 360),
]

# surcharge per route code
ROUTE_SURCHARGE = {
    "MNL-CEB": Decimal("300.00"),
    "MNL-ILO": Decimal("250.00"),
    "MNL-BCD": Decimal("270.00"),
    "CEB-CGY": Decimal("150.00"),
}

ROLES = [
    ("CUSTOMER", "Customer", "Standard customer"),
    ("ADMIN", "Admin", "System administrator"),
    ("OPERATIONS", "Operations", "Operations team"),
    ("TICKETING_AGENT", "Ticketing Agent", "Ticketing agent"),
    ("FINANCE", "Finance", "Finance team"),
    ("SUPPORT", "Support", "Support team"),
]


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

PROMOTIONS = [
    (
        "SUMMER20",
        "Summer Sale 20%",
        "20% off summer season",
        PromotionDiscountType.PERCENT,
        Decimal("20.00"),
        100,
        datetime.datetime(2026, 6, 1, tzinfo=datetime.timezone.utc),
        datetime.datetime(2026, 9, 30, 23, 59, 59, tzinfo=datetime.timezone.utc),
    ),
    (
        "WELCOME50",
        "Welcome Discount",
        "Flat 50 off for new users",
        PromotionDiscountType.FIXED,
        Decimal("50.00"),
        500,
        None,
        None,
    ),
    (
        "SENIORPLUS",
        "Senior Plus",
        "Extra 10% for seniors",
        PromotionDiscountType.PERCENT,
        Decimal("10.00"),
        200,
        datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc),
        datetime.datetime(2026, 12, 31, 23, 59, 59, tzinfo=datetime.timezone.utc),
    ),
]

VEHICLE_FARE_RULES = [
    ("MOTORCYCLE", Decimal("500.00")),
    ("SEDAN", Decimal("1200.00")),
    ("SUV", Decimal("1400.00")),
    ("VAN", Decimal("1800.00")),
    ("PICKUP", Decimal("1600.00")),
    ("TRUCK", Decimal("3000.00")),
]


def get_database_url() -> str:
    # Handle missing DATABASE_URL via get_settings, with env override.
    # Also allow fallback for test environments where default 5432 not available.
    env_url = os.getenv("DATABASE_URL")
    if env_url:
        return env_url
    try:
        return get_settings().database_url
    except Exception:
        return "postgresql+asyncpg://ferry:ferry@localhost:5432/ferry"


def get_sessionmaker():
    """
    Return a sessionmaker bound to the correct DB URL.
    Uses env DATABASE_URL if set, otherwise get_settings.
    Fallback: if primary engine's URL differs from desired, create new engine.
    """
    db_url = get_database_url()
    # Check if imported AsyncSessionLocal already matches desired URL
    # AsyncSessionLocal is bound to engine created at import time.
    # If mismatch, create new sessionmaker.
    try:
        from app.database.session import engine as _engine
        if str(_engine.url) == db_url:
            return AsyncSessionLocal
    except Exception:
        pass
    # Create new engine/sessionmaker for the desired URL
    # Support sqlite for tests: need aiosqlite driver
    engine = create_async_engine(db_url, echo=False, future=True)
    return async_sessionmaker(engine, expire_on_commit=False), engine


async def ensure_tables(engine=None):
    """Ensure tables exist: create_all fallback for fresh DB (especially sqlite)."""
    if engine is None:
        try:
            from app.database.session import engine as _engine
            engine = _engine
        except Exception:
            db_url = get_database_url()
            engine = create_async_engine(db_url, echo=False, future=True)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    except Exception as e:
        # Duplicate index issue on sqlite (ix_trips_departure_at) – ignore
        if "already exists" in str(e):
            print(f"  ensure_tables warning (ignore): {e}")
        else:
            # For postgres, create_all is idempotent but may fail if tables exist via alembic; ignore
            if "already exists" in str(e).lower():
                print(f"  ensure_tables warning: {e}")
            else:
                # Try to continue; tables may already exist via alembic
                print(f"  ensure_tables note: {e}")


async def seed():
    # Determine sessionmaker and engine
    sm_result = get_sessionmaker()
    # get_sessionmaker returns either AsyncSessionLocal or (sessionmaker, engine)
    if isinstance(sm_result, tuple):
        SessionLocal, engine = sm_result
        close_engine = True
    else:
        SessionLocal = sm_result
        from app.database.session import engine
        close_engine = False

    # Ensure tables exist (for fresh DB without alembic)
    await ensure_tables(engine)

    # For postgres fallback port handling: if connection fails on 5432, try 5433
    # We will attempt to connect and if fails, retry with 5433
    async def can_connect(sessionmaker) -> bool:
        try:
            async with sessionmaker() as db:
                await db.execute(text("SELECT 1"))
            return True
        except Exception as e:
            print(f"  DB connection check failed: {e}")
            return False

    if not await can_connect(SessionLocal):
        # Try fallback port 5433 if url contains 5432
        db_url = get_database_url()
        if "5432" in db_url:
            fallback_url = db_url.replace("5432", "5433")
            print(f"  Primary DB unavailable, trying fallback {fallback_url}")
            fallback_engine = create_async_engine(fallback_url, echo=False, future=True)
            SessionLocal = async_sessionmaker(fallback_engine, expire_on_commit=False)
            engine = fallback_engine
            close_engine = True
            await ensure_tables(engine)
            if not await can_connect(SessionLocal):
                # Try sqlite in-memory as last resort for local verification?
                # But for real seed we need postgres; abort if still failing
                print("  Fallback DB also unavailable, proceeding anyway (seed will fail if DB down)")
            else:
                # Patch global session for GraphQL verification (which uses AsyncSessionLocal bound to 5432)
                try:
                    import app.database.session as _sess_mod
                    _sess_mod.engine = fallback_engine
                    _sess_mod.AsyncSessionLocal = SessionLocal
                    # Also update our imported reference for consistency
                    print(f"  Patched AsyncSessionLocal to use fallback DB")
                except Exception as _e:
                    print(f"  Could not patch session: {_e}")
        # else no fallback

    async with SessionLocal() as db:
        # --- Idempotent checks: collect existing ---
        # Ports
        res = await db.execute(select(func.count()).select_from(Port))
        port_count_before = res.scalar_one()
        existing_ports = set()
        if port_count_before > 0:
            res = await db.execute(select(Port.code))
            existing_ports = {r[0] for r in res.all()}
        ports_to_create = []
        port_map = {}
        for code, name, city, province in PORTS:
            if code not in existing_ports:
                p = Port(id=str(uuid.uuid4()), code=code, name=name, city=city, province=province, country="Philippines", timezone="Asia/Manila", active=True)
                db.add(p)
                ports_to_create.append(p)
            else:
                # fetch existing for route linking
                res = await db.execute(select(Port).where(Port.code == code))
                p = res.scalar_one()
                port_map[code] = p
        if ports_to_create:
            await db.flush()
            for p in ports_to_create:
                port_map[p.code] = p
            print(f"  Created {len(ports_to_create)} ports")
        else:
            # populate port_map from existing if not already
            if not port_map:
                res = await db.execute(select(Port))
                for p in res.scalars().all():
                    port_map[p.code] = p

        # Accommodation types
        res = await db.execute(select(func.count()).select_from(AccommodationType))
        acc_count_before = res.scalar_one()
        existing_acc = {}
        if acc_count_before > 0:
            res = await db.execute(select(AccommodationType))
            for a in res.scalars().all():
                existing_acc[a.code] = a
        acc_map = {}
        acc_created = 0
        for code, name, desc, cap, price in ACCOMMODATIONS:
            if code not in existing_acc:
                a = AccommodationType(id=str(uuid.uuid4()), code=code, name=name, description=desc, capacity=cap, base_price=price, active=True)
                db.add(a)
                acc_map[code] = a
                acc_created += 1
            else:
                acc_map[code] = existing_acc[code]
        if acc_created:
            await db.flush()
            print(f"  Created {acc_created} accommodation types")
        # Ensure acc_map complete if not flushed yet but existed
        if not acc_map and existing_acc:
            acc_map = existing_acc

        # Vessels with decks/sections/seats
        res = await db.execute(select(func.count()).select_from(Vessel))
        vessel_count_before = res.scalar_one()
        existing_vessels = {}
        if vessel_count_before > 0:
            res = await db.execute(select(Vessel))
            for v in res.scalars().all():
                existing_vessels[v.code] = v
        vessel_map = {}
        vessels_created = 0
        for code, name, reg, cap, veh_cap in VESSELS:
            if code not in existing_vessels:
                v = Vessel(id=str(uuid.uuid4()), code=code, name=name, registration_number=reg, capacity=cap, vehicle_capacity=veh_cap, status="ACTIVE", active=True)
                db.add(v)
                await db.flush()
                vessel_map[code] = v
                vessels_created += 1
                # Create decks and sections
                # 2 decks per vessel
                decks = []
                for deck_order, deck_name in enumerate(["Main Deck", "Upper Deck"], start=1):
                    deck = VesselDeck(id=str(uuid.uuid4()), vessel_id=v.id, name=deck_name, deck_order=deck_order)
                    db.add(deck)
                    await db.flush()
                    decks.append(deck)
                # 3 sections per deck -> 6 total, cycle accommodation types
                acc_codes = [c for c, _, _, _, _ in ACCOMMODATIONS]
                section_idx = 0
                for deck in decks:
                    for sec_num in range(1, 4):  # 3 sections per deck
                        acc_code = acc_codes[section_idx % len(acc_codes)]
                        acc = acc_map[acc_code]
                        section_name = f"{deck.name} - {acc_code} Section {sec_num}"
                        capacity = 20
                        section = VesselSection(id=str(uuid.uuid4()), deck_id=deck.id, accommodation_type_id=acc.id, name=section_name, capacity=capacity)
                        db.add(section)
                        await db.flush()
                        # Create 10 seats per section
                        for seat_i in range(1, 11):
                            seat_number = f"{acc_code}-{chr(64+deck.deck_order)}{sec_num}{seat_i:02d}"  # e.g., SV-A101
                            # Ensure seat_number unique per section, up to 20 chars
                            # Truncate if needed: use SV-A101 style
                            seat = VesselSeat(id=str(uuid.uuid4()), section_id=section.id, seat_number=seat_number, status="AVAILABLE")
                            db.add(seat)
                        section_idx += 1
                print(f"  Created vessel {code} with decks/sections/seats")
            else:
                vessel_map[code] = existing_vessels[code]
        if vessels_created:
            await db.flush()
            print(f"  Created {vessels_created} vessels")
        else:
            if not vessel_map and existing_vessels:
                vessel_map = existing_vessels

        # Routes
        res = await db.execute(select(func.count()).select_from(Route))
        route_count_before = res.scalar_one()
        existing_routes = {}
        if route_count_before > 0:
            res = await db.execute(select(Route))
            for r in res.scalars().all():
                existing_routes[r.code] = r
        route_map = {}
        routes_created = 0
        for code, origin_code, dest_code, dist, dur in ROUTES:
            if code not in existing_routes:
                origin = port_map.get(origin_code)
                dest = port_map.get(dest_code)
                if not origin or not dest:
                    print(f"  Skipping route {code}: missing ports")
                    continue
                route = Route(id=str(uuid.uuid4()), code=code, origin_port_id=origin.id, destination_port_id=dest.id, distance_km=dist, estimated_duration_minutes=dur, active=True)
                db.add(route)
                await db.flush()
                route_map[code] = route
                # Create RouteStop maybe? Optional – create 2 stops origin/dest
                for idx, port in enumerate([origin, dest], start=1):
                    rs = RouteStop(id=str(uuid.uuid4()), route_id=route.id, port_id=port.id, stop_order=idx)
                    db.add(rs)
                routes_created += 1
                print(f"  Created route {code}")
            else:
                route_map[code] = existing_routes[code]
        if routes_created:
            await db.flush()
            print(f"  Created {routes_created} routes")
        else:
            if not route_map and existing_routes:
                route_map = existing_routes

        # Roles
        res = await db.execute(select(func.count()).select_from(Role))
        role_count_before = res.scalar_one()
        existing_roles = {}
        if role_count_before > 0:
            res = await db.execute(select(Role))
            for r in res.scalars().all():
                existing_roles[r.code] = r
        role_map = {}
        roles_created = 0
        for code, name, desc in ROLES:
            if code not in existing_roles:
                role = Role(id=str(uuid.uuid4()), code=code, name=name, description=desc)
                db.add(role)
                role_map[code] = role
                roles_created += 1
            else:
                role_map[code] = existing_roles[code]
        if roles_created:
            await db.flush()
            print(f"  Created {roles_created} roles")
        else:
            if not role_map and existing_roles:
                role_map = existing_roles

        # Admin user
        admin_email = "admin@ferry.ph"
        res = await db.execute(select(User).where(User.email == admin_email))
        admin_user = res.scalar_one_or_none()
        if not admin_user:
            hashed = hash_password("Admin123!")
            admin_user = User(id=str(uuid.uuid4()), email=admin_email, password_hash=hashed, first_name="Admin", last_name="User", is_active=True)
            # attach ADMIN role
            admin_role = role_map.get("ADMIN")
            if admin_role:
                admin_user.roles.append(admin_role)
            db.add(admin_user)
            await db.flush()
            print(f"  Created admin user {admin_email}")
        else:
            # ensure has ADMIN role
            has_admin = any(r.code == "ADMIN" for r in admin_user.roles)
            if not has_admin and "ADMIN" in role_map:
                admin_user.roles.append(role_map["ADMIN"])
                await db.flush()
                print(f"  Updated admin user roles")

        # Trips: 10+ trips next 14 days with ~60 TripSeats each
        res = await db.execute(select(func.count()).select_from(Trip))
        trip_count_before = res.scalar_one()
        trips_created = 0
        if trip_count_before < 10:
            # Need to create trips up to 12
            num_to_create = max(12 - trip_count_before, 12) if trip_count_before == 0 else 12 - trip_count_before
            # If fresh, create 12; if partial, create enough to reach 12
            if trip_count_before == 0:
                num_to_create = 12
            print(f"  Generating {num_to_create} trips...")
            # Prepare lists
            route_list = list(route_map.values())
            vessel_list = list(vessel_map.values())
            if not route_list or not vessel_list:
                print("  Cannot create trips: missing routes or vessels")
            else:
                # For deterministic but varied, randomize with fixed seed
                random.seed(42)
                base_date = datetime.datetime.now(datetime.timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
                # For Asia/Manila, departure 20:00 (12:00 UTC) – use 12:00 UTC = 20:00 Manila
                for i in range(num_to_create):
                    route = random.choice(route_list)
                    vessel = random.choice(vessel_list)
                    # Randomize next 14 days
                    offset_days = random.randint(1, 14)
                    # Ensure departure is at 20:00 Manila = 12:00 UTC
                    departure_at = base_date + datetime.timedelta(days=offset_days, hours=12)  # 12 UTC
                    departure_at = departure_at.replace(tzinfo=datetime.timezone.utc)
                    arrival_at = departure_at + datetime.timedelta(hours=12)
                    # Ensure departure ports match route
                    departure_port_id = route.origin_port_id
                    arrival_port_id = route.destination_port_id
                    # Generate booking open/close
                    booking_open = departure_at - datetime.timedelta(days=7)
                    booking_close = departure_at - datetime.timedelta(hours=2)
                    trip = Trip(
                        id=str(uuid.uuid4()),
                        route_id=route.id,
                        vessel_id=vessel.id,
                        departure_port_id=departure_port_id,
                        arrival_port_id=arrival_port_id,
                        departure_at=departure_at,
                        arrival_at=arrival_at,
                        status=TripStatus.SCHEDULED,
                        booking_open=booking_open,
                        booking_close=booking_close,
                    )
                    db.add(trip)
                    await db.flush()
                    # Generate 60 TripSeats
                    surcharge = ROUTE_SURCHARGE.get(route.code, Decimal("200.00"))
                    # For each accommodation, 10 seats
                    seat_counter = {}
                    for acc_code, acc_name, _, _, base_price in ACCOMMODATIONS:
                        acc = acc_map[acc_code]
                        price = (base_price + surcharge).quantize(Decimal("0.01"))
                        for n in range(1, 11):
                            # seat_number like SV-A01 etc but must be unique per trip
                            # Use acc_code + sequential within acc: e.g., SV01..SV10, but prefix ensures unique across acc
                            # Use format SV-01 etc
                            seat_number = f"{acc_code}-{n:02d}" if acc_code not in seat_counter else f"{acc_code}-{seat_counter[acc_code]+n:02d}"
                            # Better: global unique using acc and n and trip index
                            # To avoid collision, make seat_number = f"{acc_code}-{i*10+n:02d}" would be 60 unique already via code prefix, but for same code, n 01-10 distinct
                            # So for each acc, seat_number acc_code + n is unique; no collision across acc because prefix differs
                            # However TripSeat unique is (trip_id, seat_number), so acc_code prefix ensures unique even if n overlaps
                            # Use detailed: SV-A01 style with deck-like letter via trip index
                            # To satisfy spec "like SV-A01", we do:
                            letter = chr(65 + (i % 6))  # trip variation
                            seat_number_detailed = f"{acc_code}-{letter}{n:02d}"
                            trip_seat = TripSeat(
                                id=str(uuid.uuid4()),
                                trip_id=trip.id,
                                vessel_seat_id=None,
                                seat_number=seat_number_detailed,
                                accommodation_type_id=acc.id,
                                status=TripSeatStatus.AVAILABLE,
                                price=price,
                            )
                            db.add(trip_seat)
                    trips_created += 1
                await db.flush()
                print(f"  Created {trips_created} trips with ~{trips_created*60} seats")
        else:
            print(f"  Trips already exist ({trip_count_before}), skipping creation")

        # --- Passenger types (idempotent) ---
        res = await db.execute(select(func.count()).select_from(PassengerType))
        pt_count_before = res.scalar_one()
        existing_pt_codes = set()
        pt_map = {}
        if pt_count_before > 0:
            res = await db.execute(select(PassengerType))
            for pt in res.scalars().all():
                existing_pt_codes.add(pt.code)
                pt_map[pt.code] = pt
        pt_created = 0
        for code, name, desc, discount, requires_id in PASSENGER_TYPES:
            if code not in existing_pt_codes:
                # quantized discount
                disc_q = discount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                pt = PassengerType(
                    id=str(uuid.uuid4()),
                    code=code,
                    name=name,
                    description=desc,
                    discount_percent=disc_q,
                    requires_id=requires_id,
                    active=True,
                )
                db.add(pt)
                pt_map[code] = pt
                pt_created += 1
                existing_pt_codes.add(code)
        if pt_created:
            await db.flush()
            print(f"  Created {pt_created} passenger_types")
        else:
            if not pt_map and pt_count_before > 0:
                res = await db.execute(select(PassengerType))
                for pt in res.scalars().all():
                    pt_map[pt.code] = pt

        # --- Fare components (idempotent) ---
        res = await db.execute(select(func.count()).select_from(FareComponent))
        fc_count_before = res.scalar_one()
        existing_fc_codes = set()
        if fc_count_before > 0:
            res = await db.execute(select(FareComponent.code))
            existing_fc_codes = {r[0] for r in res.all()}
        fc_created = 0
        for code, name, amount, percent, is_percent in FARE_COMPONENTS:
            if code not in existing_fc_codes:
                amt_q = amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if amount is not None else None
                pct_q = percent.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if percent is not None else None
                fc = FareComponent(
                    id=str(uuid.uuid4()),
                    code=code,
                    name=name,
                    description=name,
                    amount=amt_q,
                    percent=pct_q,
                    is_percent=is_percent,
                    active=True,
                )
                db.add(fc)
                fc_created += 1
                existing_fc_codes.add(code)
        if fc_created:
            await db.flush()
            print(f"  Created {fc_created} fare_components")
        # no need to map

        # --- Fare rules (idempotent) 4 routes x 6 accommodations = 24 ---
        res = await db.execute(select(func.count()).select_from(FareRule))
        fr_count_before = res.scalar_one()
        existing_fr_keys = set()
        if fr_count_before > 0:
            res = await db.execute(select(FareRule.route_id, FareRule.accommodation_type_id))
            for route_id, acc_id in res.all():
                existing_fr_keys.add((route_id, acc_id))
        fr_created = 0
        for route_code, route in route_map.items():
            surcharge = ROUTE_SURCHARGE.get(route_code, Decimal("200.00"))
            for acc_code, acc in acc_map.items():
                key = (route.id, acc.id)
                if key not in existing_fr_keys:
                    base_fare = (acc.base_price + surcharge).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                    fr = FareRule(
                        id=str(uuid.uuid4()),
                        route_id=route.id,
                        accommodation_type_id=acc.id,
                        passenger_type_id=None,
                        vessel_id=None,
                        base_fare=base_fare,
                        active=True,
                    )
                    db.add(fr)
                    fr_created += 1
                    existing_fr_keys.add(key)
        if fr_created:
            await db.flush()
            print(f"  Created {fr_created} fare_rules")
        else:
            # if already 24, keep silent
            pass

        # --- Promotions (idempotent) ---
        res = await db.execute(select(func.count()).select_from(Promotion))
        promo_count_before = res.scalar_one()
        existing_promo_codes = set()
        if promo_count_before > 0:
            res = await db.execute(select(Promotion.code))
            existing_promo_codes = {r[0] for r in res.all()}
        promo_created = 0
        for code, name, desc, disc_type, disc_val, max_uses, valid_from, valid_to in PROMOTIONS:
            if code not in existing_promo_codes:
                val_q = disc_val.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                promo = Promotion(
                    id=str(uuid.uuid4()),
                    code=code,
                    name=name,
                    description=desc,
                    discount_type=disc_type,
                    discount_value=val_q,
                    max_uses=max_uses,
                    used_count=0,
                    active=True,
                    valid_from=valid_from,
                    valid_to=valid_to,
                    min_passengers=1,
                )
                db.add(promo)
                promo_created += 1
                existing_promo_codes.add(code)
        if promo_created:
            await db.flush()
            print(f"  Created {promo_created} promotions")

        # --- Vehicle fare rules (idempotent) ---
        res = await db.execute(select(func.count()).select_from(VehicleFareRule))
        vfr_count_before = res.scalar_one()
        existing_vtype = set()
        if vfr_count_before > 0:
            res = await db.execute(select(VehicleFareRule.vehicle_type))
            existing_vtype = {r[0] for r in res.all()}
        vfr_created = 0
        for vtype, fee in VEHICLE_FARE_RULES:
            if vtype not in existing_vtype:
                fee_q = fee.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                vfr = VehicleFareRule(
                    id=str(uuid.uuid4()),
                    vehicle_type=vtype,
                    base_fee=fee_q,
                    active=True,
                )
                db.add(vfr)
                vfr_created += 1
                existing_vtype.add(vtype)
        if vfr_created:
            await db.flush()
            print(f"  Created {vfr_created} vehicle_fare_rules")

        await db.commit()

        # --- Final counts for summary ---
        # Re-query counts
        counts = {}
        for model, label in [(Port, "ports"), (Route, "routes"), (Vessel, "vessels"), (Trip, "trips"), (AccommodationType, "accommodation_types"), (Role, "roles"), (User, "users")]:
            res = await db.execute(select(func.count()).select_from(model))
            counts[label] = res.scalar_one()
        res = await db.execute(select(func.count()).select_from(TripSeat))
        counts["trip_seats"] = res.scalar_one()
        # Vessel seats count
        res = await db.execute(select(func.count()).select_from(VesselSeat))
        counts["vessel_seats"] = res.scalar_one()

        # Also vessel decks/sections
        res = await db.execute(select(func.count()).select_from(VesselDeck))
        counts["vessel_decks"] = res.scalar_one()
        res = await db.execute(select(func.count()).select_from(VesselSection))
        counts["vessel_sections"] = res.scalar_one()

        print("\nSeeded summary:")
        print(f"  Ports: {counts['ports']}, Routes: {counts['routes']}, Vessels: {counts['vessels']}, Trips: {counts['trips']}")
        print(f"  Accommodation types: {counts['accommodation_types']}, Roles: {counts['roles']}, Users: {counts['users']}")
        print(f"  TripSeats: {counts['trip_seats']}, VesselSeats: {counts['vessel_seats']}")
        print(f"  VesselDecks: {counts['vessel_decks']}, VesselSections: {counts['vessel_sections']}")

        # Fare counts
        for model, label in [
            (PassengerType, "passenger_types"),
            (FareComponent, "fare_components"),
            (FareRule, "fare_rules"),
            (Promotion, "promotions"),
            (VehicleFareRule, "vehicle_fares"),
        ]:
            res = await db.execute(select(func.count()).select_from(model))
            counts[label] = res.scalar_one()
        print(f"  PassengerTypes: {counts['passenger_types']}, FareComponents: {counts['fare_components']}, FareRules: {counts['fare_rules']}, Promotions: {counts['promotions']}, VehicleFares: {counts['vehicle_fares']}")

        seeded_ports = counts['ports']
        seeded_routes = counts['routes']
        seeded_vessels = counts['vessels']
        seeded_trips = counts['trips']
        print(f"\nSeeded {seeded_ports} ports, {seeded_routes} routes, {seeded_vessels} vessels, {seeded_trips} trips")
        print(f"Seeded passenger_types {counts['passenger_types']}, fare_components {counts['fare_components']}, fare_rules {counts['fare_rules']}, promotions {counts['promotions']}, vehicle_fares {counts['vehicle_fares']}")

        # --- GraphQL verification ---
        print("\nVerifying via GraphQL (ASGI)...")
        try:
            from httpx import AsyncClient, ASGITransport
            from app.main import app as fastapi_app

            # Try new httpx style
            try:
                transport = ASGITransport(app=fastapi_app)
                async with AsyncClient(transport=transport, base_url="http://test") as ac:
                    q_ports = {"query": "{ ports { code name } }"}
                    r = await ac.post("/graphql", json=q_ports)
                    if r.status_code == 200:
                        data = r.json().get("data", {})
                        ports_data = data.get("ports")
                        if ports_data is not None:
                            print(f"  GraphQL ports verification: {len(ports_data)} ports returned")
                        else:
                            print(f"  GraphQL ports returned none: {r.json()}")
                    else:
                        print(f"  GraphQL ports status {r.status_code}: {r.text[:200]}")

                    q_acc = {"query": "{ accommodationTypes { code name basePrice } }"}
                    r2 = await ac.post("/graphql", json=q_acc)
                    if r2.status_code == 200:
                        acc_data = r2.json().get("data", {}).get("accommodationTypes")
                        if acc_data is not None:
                            print(f"  GraphQL accommodationTypes verification: {len(acc_data)} types returned")

                    # Search trips for first route
                    if route_list if 'route_list' in locals() else counts['routes'] > 0:
                        # Pick MNL-CEB route for search, use tomorrow date
                        try:
                            # Find MNL and CEB port ids
                            res_ports = await db.execute(select(Port).where(Port.code.in_(["MNL", "CEB"])))
                            port_by_code = {p.code: p for p in res_ports.scalars().all()}
                            if "MNL" in port_by_code and "CEB" in port_by_code:
                                tomorrow = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=2)).date().isoformat()
                                q_search = {"query": f'query {{ searchTrips(originPortId: "{port_by_code["MNL"].id}", destinationPortId: "{port_by_code["CEB"].id}", departureDate: "{tomorrow}") {{ id departureAt }} }}'}
                                r3 = await ac.post("/graphql", json=q_search)
                                if r3.status_code == 200:
                                    trips_data = r3.json().get("data", {}).get("searchTrips")
                                    if trips_data is not None:
                                        print(f"  GraphQL searchTrips verification: {len(trips_data)} trips for {tomorrow}")
                        except Exception as e:
                            print(f"  GraphQL searchTrips verification failed: {e}")

            except Exception as e:
                print(f"  GraphQL verification failed (fallback): {e}")
                # Fallback direct DB count already printed
        except Exception as e:
            print(f"  GraphQL verification import failed: {e}")
            print(f"  Direct DB verification: ports={counts['ports']}, routes={counts['routes']}, vessels={counts['vessels']}, trips={counts['trips']}")

        if close_engine:
            await engine.dispose()

        return counts


if __name__ == "__main__":
    asyncio.run(seed())
