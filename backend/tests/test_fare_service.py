import pytest
import datetime
import uuid
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import select

from app.services.fare_service import calculate_fare, quantize, ROUTE_SURCHARGE
from app.models.port import Port
from app.models.route import Route
from app.models.accommodation import AccommodationType
from app.models.vessel import Vessel
from app.models.trip import Trip
from app.models.passenger import PassengerType
from app.models.fare import FareComponent, FareRule, Promotion, PromotionRule, VehicleFareRule, PromotionDiscountType


pytestmark = pytest.mark.asyncio


async def _setup_base(db, include_fare_rule=True, route_code="MNL-CEB"):
    # Ports
    mnl = Port(id=str(uuid.uuid4()), code="MNL", name="Manila North Harbor", city="Manila", province="Metro Manila", country="Philippines", timezone="Asia/Manila", active=True)
    ceb = Port(id=str(uuid.uuid4()), code="CEB", name="Cebu Port", city="Cebu City", province="Cebu", country="Philippines", timezone="Asia/Manila", active=True)
    db.add_all([mnl, ceb])
    await db.flush()

    route = Route(id=str(uuid.uuid4()), code=route_code, origin_port_id=mnl.id, destination_port_id=ceb.id, distance_km=Decimal("500.00"), estimated_duration_minutes=720, active=True)
    db.add(route)
    await db.flush()

    # Accommodations
    acc_sv = AccommodationType(id=str(uuid.uuid4()), code="SV", name="Super Value", description="Budget open seating", capacity=100, base_price=Decimal("850.00"), active=True)
    # optional other accom for fallback test
    db.add(acc_sv)
    await db.flush()

    vessel = Vessel(id=str(uuid.uuid4()), code="SFX", name="MV St. Francis Xavier", registration_number=f"REG-{uuid.uuid4().hex[:6]}", capacity=1000, vehicle_capacity=50, status="ACTIVE", active=True)
    db.add(vessel)
    await db.flush()

    now = datetime.datetime.now(datetime.timezone.utc)
    departure_at = now + datetime.timedelta(days=1)
    arrival_at = departure_at + datetime.timedelta(hours=12)
    trip = Trip(
        id=str(uuid.uuid4()),
        route_id=route.id,
        vessel_id=vessel.id,
        departure_port_id=mnl.id,
        arrival_port_id=ceb.id,
        departure_at=departure_at,
        arrival_at=arrival_at,
        status="SCHEDULED",
    )
    db.add(trip)
    await db.flush()

    # Passenger types 6
    pts = []
    for code, name, discount, req in [
        ("ADULT", "Adult", Decimal("0.00"), False),
        ("CHILD", "Child", Decimal("20.00"), False),
        ("SENIOR", "Senior Citizen", Decimal("20.00"), True),
        ("PWD", "PWD", Decimal("20.00"), True),
        ("STUDENT", "Student", Decimal("15.00"), True),
        ("INFANT", "Infant", Decimal("90.00"), False),
    ]:
        pt = PassengerType(id=str(uuid.uuid4()), code=code, name=name, description=name, discount_percent=discount, requires_id=req, active=True)
        db.add(pt)
        pts.append(pt)
    await db.flush()

    # Fare components
    terminal = FareComponent(id=str(uuid.uuid4()), code="TERMINAL_FEE", name="Terminal Fee", description="Terminal Fee", amount=Decimal("30.00"), percent=None, is_percent=False, active=True)
    service = FareComponent(id=str(uuid.uuid4()), code="SERVICE_FEE", name="Service Fee", description="Service Fee", amount=Decimal("50.00"), percent=None, is_percent=False, active=True)
    vat = FareComponent(id=str(uuid.uuid4()), code="VAT", name="VAT 12%", description="VAT", amount=None, percent=Decimal("12.00"), is_percent=True, active=True)
    db.add_all([terminal, service, vat])
    await db.flush()

    if include_fare_rule:
        # Route surcharge for MNL-CEB is 300, so base 850+300=1150
        surcharge = ROUTE_SURCHARGE.get(route_code, Decimal("200.00"))
        base = (Decimal("850.00") + surcharge).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        rule = FareRule(id=str(uuid.uuid4()), route_id=route.id, accommodation_type_id=acc_sv.id, passenger_type_id=None, vessel_id=None, base_fare=base, active=True)
        db.add(rule)
        await db.flush()

    # Vehicle fare rule for car etc
    v_car = VehicleFareRule(id=str(uuid.uuid4()), vehicle_type="CAR", base_fee=Decimal("1200.00"), active=True)
    v_moto = VehicleFareRule(id=str(uuid.uuid4()), vehicle_type="MOTORCYCLE", base_fee=Decimal("500.00"), active=True)
    db.add_all([v_car, v_moto])
    await db.flush()

    await db.commit()
    # refresh to ensure relationships
    await db.refresh(trip)
    await db.refresh(acc_sv)
    # also load route for trip code check
    await db.refresh(route)

    # map passenger codes to ids
    pt_map = {p.code: p for p in pts}

    return {
        "mnl": mnl,
        "ceb": ceb,
        "route": route,
        "acc_sv": acc_sv,
        "vessel": vessel,
        "trip": trip,
        "pts": pt_map,
        "terminal": terminal,
        "service": service,
        "vat": vat,
    }


async def test_adult_no_promo(db):
    ctx = await _setup_base(db)
    breakdown = await calculate_fare(db, trip_id=ctx["trip"].id, accommodation_type_id=ctx["acc_sv"].id, passenger_type_code="ADULT")
    # base 1150 + terminal 30 + service 50 = 1230 + VAT12% = 147.60 => 1377.60
    assert breakdown.base_fare == Decimal("1150.00")
    assert breakdown.terminal_fee == Decimal("30.00")
    assert breakdown.service_fee == Decimal("50.00")
    assert breakdown.vehicle_fee == Decimal("0.00")
    assert breakdown.accommodation_fee == Decimal("0.00")
    assert breakdown.discount == Decimal("0.00")
    assert breakdown.tax == Decimal("147.60")
    assert breakdown.total == Decimal("1377.60")
    # ensure Decimal types
    for field in [breakdown.base_fare, breakdown.total, breakdown.tax]:
        assert isinstance(field, Decimal)
    # quantize check
    assert breakdown.total == breakdown.total.quantize(Decimal("0.01"))


async def test_child_discount_20pct(db):
    ctx = await _setup_base(db)
    breakdown = await calculate_fare(db, trip_id=ctx["trip"].id, accommodation_type_id=ctx["acc_sv"].id, passenger_type_code="CHILD")
    # child 20% of base 1150 = 230, subtotal 1230, taxable 1000, tax 120, total 1120
    assert breakdown.discount == Decimal("230.00")
    assert breakdown.tax == Decimal("120.00")
    assert breakdown.total == Decimal("1120.00")
    # base unchanged
    assert breakdown.base_fare == Decimal("1150.00")


async def test_senior_discount_20pct(db):
    ctx = await _setup_base(db)
    breakdown = await calculate_fare(db, trip_id=ctx["trip"].id, accommodation_type_id=ctx["acc_sv"].id, passenger_type_code="SENIOR")
    assert breakdown.discount == Decimal("230.00")
    assert breakdown.total == Decimal("1120.00")


async def test_infant_90pct_discount(db):
    ctx = await _setup_base(db)
    breakdown = await calculate_fare(db, trip_id=ctx["trip"].id, accommodation_type_id=ctx["acc_sv"].id, passenger_type_code="INFANT")
    # 90% of 1150 = 1035, subtotal 1230, taxable 195, tax 23.40 total 218.40
    assert breakdown.discount == Decimal("1035.00")
    assert breakdown.tax == Decimal("23.40")
    assert breakdown.total == Decimal("218.40")


async def test_invalid_promo_raises(db):
    ctx = await _setup_base(db)
    with pytest.raises(ValueError) as exc:
        await calculate_fare(db, trip_id=ctx["trip"].id, accommodation_type_id=ctx["acc_sv"].id, passenger_type_code="ADULT", promo_code="FAKECODE")
    assert "INVALID_PROMO" in str(exc.value)


async def test_promo_expired_raises(db):
    ctx = await _setup_base(db)
    # create expired promotion
    promo = Promotion(
        id=str(uuid.uuid4()),
        code="EXPIRED10",
        name="Expired",
        description="expired",
        discount_type=PromotionDiscountType.PERCENT,
        discount_value=Decimal("10.00"),
        max_uses=10,
        used_count=0,
        active=True,
        valid_from=datetime.datetime(2025, 1, 1, tzinfo=datetime.timezone.utc),
        valid_to=datetime.datetime(2025, 1, 31, tzinfo=datetime.timezone.utc),
    )
    db.add(promo)
    await db.commit()
    with pytest.raises(ValueError) as exc:
        await calculate_fare(db, trip_id=ctx["trip"].id, accommodation_type_id=ctx["acc_sv"].id, passenger_type_code="ADULT", promo_code="EXPIRED10")
    assert "PROMO_EXPIRED" in str(exc.value)


async def test_promo_usage_exceeded_raises(db):
    ctx = await _setup_base(db)
    promo = Promotion(
        id=str(uuid.uuid4()),
        code="LIMIT1",
        name="Limited",
        description="limited",
        discount_type=PromotionDiscountType.FIXED,
        discount_value=Decimal("50.00"),
        max_uses=1,
        used_count=1,
        active=True,
        valid_from=None,
        valid_to=None,
    )
    db.add(promo)
    await db.commit()
    with pytest.raises(ValueError) as exc:
        await calculate_fare(db, trip_id=ctx["trip"].id, accommodation_type_id=ctx["acc_sv"].id, passenger_type_code="ADULT", promo_code="LIMIT1")
    assert "PROMO_USAGE_EXCEEDED" in str(exc.value)


async def test_promo_percent_discount(db):
    ctx = await _setup_base(db)
    promo = Promotion(
        id=str(uuid.uuid4()),
        code="SUMMER20",
        name="Summer 20%",
        description="20% off",
        discount_type=PromotionDiscountType.PERCENT,
        discount_value=Decimal("20.00"),
        max_uses=100,
        used_count=0,
        active=True,
        valid_from=datetime.datetime(2026, 6, 1, tzinfo=datetime.timezone.utc),
        valid_to=datetime.datetime(2026, 9, 30, 23, 59, 59, tzinfo=datetime.timezone.utc),
    )
    db.add(promo)
    await db.commit()
    breakdown = await calculate_fare(db, trip_id=ctx["trip"].id, accommodation_type_id=ctx["acc_sv"].id, passenger_type_code="ADULT", promo_code="SUMMER20")
    # subtotal 1230, passenger 0, promo 20% of 1230 =246, taxable 984, tax 118.08, total 1102.08
    assert breakdown.discount == Decimal("246.00")
    assert breakdown.tax == Decimal("118.08")
    assert breakdown.total == Decimal("1102.08")


async def test_promo_fixed_discount(db):
    ctx = await _setup_base(db)
    promo = Promotion(
        id=str(uuid.uuid4()),
        code="WELCOME50",
        name="Welcome 50",
        description="50 off",
        discount_type=PromotionDiscountType.FIXED,
        discount_value=Decimal("50.00"),
        max_uses=500,
        used_count=0,
        active=True,
        valid_from=None,
        valid_to=None,
    )
    db.add(promo)
    await db.commit()
    breakdown = await calculate_fare(db, trip_id=ctx["trip"].id, accommodation_type_id=ctx["acc_sv"].id, passenger_type_code="ADULT", promo_code="WELCOME50")
    # discount 50, taxable 1180, tax 141.60 total 1321.60
    assert breakdown.discount == Decimal("50.00")
    assert breakdown.tax == Decimal("141.60")
    assert breakdown.total == Decimal("1321.60")


async def test_promo_fixed_clamped_exceeds_subtotal(db):
    ctx = await _setup_base(db)
    promo = Promotion(
        id=str(uuid.uuid4()),
        code="BIG5000",
        name="Big",
        description="big",
        discount_type=PromotionDiscountType.FIXED,
        discount_value=Decimal("5000.00"),
        max_uses=10,
        used_count=0,
        active=True,
    )
    db.add(promo)
    await db.commit()
    breakdown = await calculate_fare(db, trip_id=ctx["trip"].id, accommodation_type_id=ctx["acc_sv"].id, passenger_type_code="ADULT", promo_code="BIG5000")
    # clamped to subtotal 1230, taxable 0, tax 0, total 0 never negative
    assert breakdown.discount == Decimal("1230.00")
    assert breakdown.tax == Decimal("0.00")
    assert breakdown.total == Decimal("0.00")
    assert breakdown.total >= Decimal("0.00")


async def test_vehicle_fee_added(db):
    ctx = await _setup_base(db)
    breakdown = await calculate_fare(db, trip_id=ctx["trip"].id, accommodation_type_id=ctx["acc_sv"].id, passenger_type_code="ADULT", vehicle_type="CAR")
    # base 1150 + fees 80 + vehicle 1200 =2430 + tax 291.60 => 2721.60
    assert breakdown.vehicle_fee == Decimal("1200.00")
    assert breakdown.total == Decimal("2721.60")
    # with motorcycle 500
    breakdown2 = await calculate_fare(db, trip_id=ctx["trip"].id, accommodation_type_id=ctx["acc_sv"].id, passenger_type_code="ADULT", vehicle_type="MOTORCYCLE")
    assert breakdown2.vehicle_fee == Decimal("500.00")
    # 1150+80+500=1730 tax 207.60 total 1937.60
    assert breakdown2.total == Decimal("1937.60")


async def test_never_negative_total_with_infant_and_promo(db):
    ctx = await _setup_base(db)
    promo = Promotion(
        id=str(uuid.uuid4()),
        code="BIGPROMO",
        name="Big",
        description="big",
        discount_type=PromotionDiscountType.FIXED,
        discount_value=Decimal("2000.00"),
        max_uses=10,
        used_count=0,
        active=True,
    )
    db.add(promo)
    await db.commit()
    breakdown = await calculate_fare(db, trip_id=ctx["trip"].id, accommodation_type_id=ctx["acc_sv"].id, passenger_type_code="INFANT", promo_code="BIGPROMO")
    # infant discount 1035, subtotal 1230, max promo clamp to 195 => discount 1230, total 0
    assert breakdown.total == Decimal("0.00")
    assert breakdown.total >= Decimal("0.00")
    assert breakdown.discount == Decimal("1230.00")


async def test_invalid_passenger_raises(db):
    ctx = await _setup_base(db)
    with pytest.raises(ValueError) as exc:
        await calculate_fare(db, trip_id=ctx["trip"].id, accommodation_type_id=ctx["acc_sv"].id, passenger_type_code="UNKNOWN")
    assert "INVALID_PASSENGER" in str(exc.value)


async def test_trip_not_found_raises(db):
    ctx = await _setup_base(db)
    with pytest.raises(ValueError) as exc:
        await calculate_fare(db, trip_id=str(uuid.uuid4()), accommodation_type_id=ctx["acc_sv"].id, passenger_type_code="ADULT")
    assert "TRIP_NOT_FOUND" in str(exc.value)


async def test_invalid_accommodation_raises(db):
    ctx = await _setup_base(db)
    with pytest.raises(ValueError) as exc:
        await calculate_fare(db, trip_id=ctx["trip"].id, accommodation_type_id=str(uuid.uuid4()), passenger_type_code="ADULT")
    assert "INVALID_ACCOMMODATION" in str(exc.value)


async def test_invalid_vehicle_raises(db):
    ctx = await _setup_base(db)
    with pytest.raises(ValueError) as exc:
        await calculate_fare(db, trip_id=ctx["trip"].id, accommodation_type_id=ctx["acc_sv"].id, passenger_type_code="ADULT", vehicle_type="SPACESHIP")
    assert "INVALID_VEHICLE" in str(exc.value)


async def test_decimal_rounding_half_up(db):
    # quantize helper should round half up
    assert quantize(Decimal("1.005")) == Decimal("1.01")
    assert quantize(Decimal("1.004")) == Decimal("1.00")
    assert quantize(Decimal("2.345")) == Decimal("2.35")
    assert quantize(Decimal("2.344")) == Decimal("2.34")
    # also ensure breakdown total is quantized
    ctx = await _setup_base(db)
    breakdown = await calculate_fare(db, trip_id=ctx["trip"].id, accommodation_type_id=ctx["acc_sv"].id, passenger_type_code="ADULT")
    # total should have exactly 2 decimal places
    assert breakdown.total.as_tuple().exponent == -2


async def test_fallback_no_fare_rule_uses_surcharge(db):
    ctx = await _setup_base(db, include_fare_rule=False)
    # remove any rule that might have been created, ensure none
    # no rule now, so fallback base = 850 + surcharge 300 =1150 same as before
    breakdown = await calculate_fare(db, trip_id=ctx["trip"].id, accommodation_type_id=ctx["acc_sv"].id, passenger_type_code="ADULT")
    assert breakdown.base_fare == Decimal("1150.00")
    assert breakdown.total == Decimal("1377.60")
    # test with different route fallback
    # create new route CEB-CGY with surcharge 150
    # create new trip on that route and check fallback
    from sqlalchemy import select as sel
    # create CEB-CGY route trip manually
    cgy = Port(id=str(uuid.uuid4()), code="CGY", name="Cagayan", city="Cagayan", province="Mis", country="Philippines", timezone="Asia/Manila", active=True)
    db.add(cgy)
    await db.flush()
    route2 = Route(id=str(uuid.uuid4()), code="CEB-CGY", origin_port_id=ctx["ceb"].id, destination_port_id=cgy.id, distance_km=Decimal("200.00"), estimated_duration_minutes=360, active=True)
    db.add(route2)
    await db.flush()
    trip2 = Trip(
        id=str(uuid.uuid4()),
        route_id=route2.id,
        vessel_id=ctx["vessel"].id,
        departure_port_id=ctx["ceb"].id,
        arrival_port_id=cgy.id,
        departure_at=datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=2),
        arrival_at=datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=2, hours=6),
        status="SCHEDULED",
    )
    db.add(trip2)
    await db.commit()
    breakdown2 = await calculate_fare(db, trip_id=trip2.id, accommodation_type_id=ctx["acc_sv"].id, passenger_type_code="ADULT")
    # base 850+150=1000, +80=1080 tax 129.60 total 1209.60
    assert breakdown2.base_fare == Decimal("1000.00")
    assert breakdown2.total == Decimal("1209.60")


async def test_promo_with_rules_applicability(db):
    ctx = await _setup_base(db)
    promo = Promotion(
        id=str(uuid.uuid4()),
        code="ROUTELIMIT",
        name="Route limited",
        description="only for MNL-CEB",
        discount_type=PromotionDiscountType.PERCENT,
        discount_value=Decimal("10.00"),
        max_uses=10,
        used_count=0,
        active=True,
    )
    db.add(promo)
    await db.flush()
    # rule only for MNL-CEB route
    rule = PromotionRule(id=str(uuid.uuid4()), promotion_id=promo.id, route_id=ctx["route"].id, accommodation_type_id=None, passenger_type_id=None)
    db.add(rule)
    await db.commit()
    # should succeed for MNL-CEB trip
    breakdown = await calculate_fare(db, trip_id=ctx["trip"].id, accommodation_type_id=ctx["acc_sv"].id, passenger_type_code="ADULT", promo_code="ROUTELIMIT")
    assert breakdown.discount == Decimal("123.00")  # 10% of 1230
    # now create a trip on different route CEB-CGY and try same promo should fail INVALID_PROMO
    cgy = Port(id=str(uuid.uuid4()), code="CGY2", name="Cagayan2", city="Cagayan", province="Mis", country="Philippines", timezone="Asia/Manila", active=True)
    db.add(cgy)
    await db.flush()
    route2 = Route(id=str(uuid.uuid4()), code="CEB-CGY", origin_port_id=ctx["ceb"].id, destination_port_id=cgy.id, distance_km=Decimal("200.00"), estimated_duration_minutes=360, active=True)
    db.add(route2)
    await db.flush()
    trip2 = Trip(
        id=str(uuid.uuid4()),
        route_id=route2.id,
        vessel_id=ctx["vessel"].id,
        departure_port_id=ctx["ceb"].id,
        arrival_port_id=cgy.id,
        departure_at=datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=2),
        arrival_at=datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=2, hours=6),
        status="SCHEDULED",
    )
    db.add(trip2)
    await db.commit()
    with pytest.raises(ValueError) as exc:
        await calculate_fare(db, trip_id=trip2.id, accommodation_type_id=ctx["acc_sv"].id, passenger_type_code="ADULT", promo_code="ROUTELIMIT")
    assert "INVALID_PROMO" in str(exc.value)
