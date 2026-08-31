from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional
import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.trip import Trip
from app.models.route import Route
from app.models.accommodation import AccommodationType
from app.models.passenger import PassengerType
from app.models.fare import FareRule, FareComponent, Promotion, PromotionRule, VehicleFareRule, PromotionDiscountType


TWOPLACES = Decimal("0.01")

def quantize(d: Decimal) -> Decimal:
    if not isinstance(d, Decimal):
        d = Decimal(str(d))
    return d.quantize(TWOPLACES, rounding=ROUND_HALF_UP)


ROUTE_SURCHARGE: dict[str, Decimal] = {
    "MNL-CEB": Decimal("300.00"),
    "MNL-ILO": Decimal("250.00"),
    "MNL-BCD": Decimal("270.00"),
    "CEB-CGY": Decimal("150.00"),
}


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
    vehicle_type: Optional[str] = None,
    promo_code: Optional[str] = None,
) -> FareBreakdown:
    # 1. Load and validate trip, accommodation, passenger_type
    res = await db.execute(select(Trip).where(Trip.id == trip_id))
    trip = res.scalar_one_or_none()
    if trip is None:
        raise ValueError("TRIP_NOT_FOUND")

    res = await db.execute(select(AccommodationType).where(AccommodationType.id == accommodation_type_id))
    accommodation = res.scalar_one_or_none()
    if accommodation is None:
        raise ValueError("INVALID_ACCOMMODATION")

    res = await db.execute(select(PassengerType).where(PassengerType.code == passenger_type_code))
    passenger = res.scalar_one_or_none()
    if passenger is None or not passenger.active:
        raise ValueError("INVALID_PASSENGER")

    # Need route for surcharge fallback and fare rule matching
    # Trip has relationship route lazy joined, but ensure loaded
    route: Optional[Route] = None
    # try to get via relationship if already loaded
    try:
        route = trip.route  # type: ignore
    except Exception:
        route = None
    if route is None or not hasattr(route, "code") or route is None:
        # fallback query
        res = await db.execute(select(Route).where(Route.id == trip.route_id))
        route = res.scalar_one_or_none()

    # 2. base_fare from FareRule most specific else fallback
    base_fare: Optional[Decimal] = None

    # most specific: route+accommodation+passenger
    res = await db.execute(
        select(FareRule).where(
            FareRule.route_id == trip.route_id,
            FareRule.accommodation_type_id == accommodation_type_id,
            FareRule.passenger_type_id == passenger.id,
            FareRule.active == True,  # noqa: E712
        )
    )
    rule = res.scalar_one_or_none()
    if rule is not None:
        base_fare = quantize(Decimal(str(rule.base_fare)))
    else:
        # route+accommodation (passenger wildcard)
        res = await db.execute(
            select(FareRule).where(
                FareRule.route_id == trip.route_id,
                FareRule.accommodation_type_id == accommodation_type_id,
                FareRule.passenger_type_id.is_(None),
                FareRule.active == True,  # noqa: E712
            )
        )
        rule2 = res.scalar_one_or_none()
        if rule2 is not None:
            base_fare = quantize(Decimal(str(rule2.base_fare)))
        else:
            # accommodation only (route wildcard) with passenger wildcard?
            # search accommodation only rule
            res = await db.execute(
                select(FareRule).where(
                    FareRule.accommodation_type_id == accommodation_type_id,
                    FareRule.route_id.is_(None),
                    FareRule.active == True,  # noqa: E712
                )
            )
            rule3 = res.scalar_one_or_none()
            if rule3 is not None:
                base_fare = quantize(Decimal(str(rule3.base_fare)))
            else:
                # fallback: accommodation.base_price + route surcharge
                route_code = route.code if route is not None else ""
                surcharge = ROUTE_SURCHARGE.get(route_code, Decimal("200.00"))
                # accommodation.base_price is Decimal
                base_price = Decimal(str(accommodation.base_price))
                base_fare = quantize(base_price + surcharge)

    if base_fare is None:
        # should not happen, but fallback
        base_fare = quantize(Decimal(str(accommodation.base_price)))

    base_fare = quantize(base_fare)

    # 3. accommodation_fee 0 for now
    accommodation_fee = quantize(Decimal("0.00"))

    # 4. terminal_fee, service_fee from FareComponent
    def _get_fixed_fee(code: str) -> Decimal:
        return Decimal("0.00")  # placeholder for sync helper

    # async fetch
    res = await db.execute(select(FareComponent).where(FareComponent.code == "TERMINAL_FEE", FareComponent.active == True))  # noqa: E712
    comp_terminal = res.scalar_one_or_none()
    if comp_terminal is not None and comp_terminal.amount is not None:
        terminal_fee = quantize(Decimal(str(comp_terminal.amount)))
    else:
        terminal_fee = quantize(Decimal("0.00"))

    res = await db.execute(select(FareComponent).where(FareComponent.code == "SERVICE_FEE", FareComponent.active == True))  # noqa: E712
    comp_service = res.scalar_one_or_none()
    if comp_service is not None and comp_service.amount is not None:
        service_fee = quantize(Decimal(str(comp_service.amount)))
    else:
        service_fee = quantize(Decimal("0.00"))

    # 5. vehicle_fee from VehicleFareRule
    if vehicle_type is not None:
        res = await db.execute(select(VehicleFareRule).where(VehicleFareRule.vehicle_type == vehicle_type, VehicleFareRule.active == True))  # noqa: E712
        v_rule = res.scalar_one_or_none()
        if v_rule is None:
            raise ValueError("INVALID_VEHICLE")
        vehicle_fee = quantize(Decimal(str(v_rule.base_fee)))
    else:
        vehicle_fee = quantize(Decimal("0.00"))

    # 6. subtotal
    subtotal = quantize(base_fare + accommodation_fee + terminal_fee + service_fee + vehicle_fee)

    # 7. passenger_discount = base_fare * discount_percent /100
    disc_percent_raw = passenger.discount_percent
    # disc_percent may be Decimal, float, int
    if disc_percent_raw is None:
        disc_percent = Decimal("0.00")
    else:
        disc_percent = Decimal(str(disc_percent_raw))
    passenger_discount = quantize(base_fare * disc_percent / Decimal("100"))
    # clamp discount not exceed base? Actually will clamp later vs subtotal
    if passenger_discount < Decimal("0.00"):
        passenger_discount = quantize(Decimal("0.00"))
    if passenger_discount > subtotal:
        passenger_discount = quantize(subtotal)

    # 8. promo_discount
    promo_discount = quantize(Decimal("0.00"))
    if promo_code is not None:
        res = await db.execute(select(Promotion).where(Promotion.code == promo_code))
        promo = res.scalar_one_or_none()
        if promo is None:
            raise ValueError("INVALID_PROMO")
        if not promo.active:
            raise ValueError("INVALID_PROMO")

        now = datetime.datetime.now(datetime.timezone.utc)
        # ensure promo dates are timezone aware for comparison
        if promo.valid_from is not None:
            vf = promo.valid_from
            if vf.tzinfo is None:
                vf = vf.replace(tzinfo=datetime.timezone.utc)
            if now < vf:
                raise ValueError("PROMO_EXPIRED")
        if promo.valid_to is not None:
            vt = promo.valid_to
            if vt.tzinfo is None:
                vt = vt.replace(tzinfo=datetime.timezone.utc)
            if now > vt:
                raise ValueError("PROMO_EXPIRED")

        if promo.max_uses is not None and promo.used_count >= promo.max_uses:
            raise ValueError("PROMO_USAGE_EXCEEDED")

        # check promotion_rules applicability if any
        res = await db.execute(select(PromotionRule).where(PromotionRule.promotion_id == promo.id))
        rules = res.scalars().all()
        if rules:
            matched = False
            for r in rules:
                route_match = (r.route_id is None) or (r.route_id == trip.route_id)
                acc_match = (r.accommodation_type_id is None) or (r.accommodation_type_id == accommodation_type_id)
                pass_match = (r.passenger_type_id is None) or (r.passenger_type_id == passenger.id)
                if route_match and acc_match and pass_match:
                    matched = True
                    break
            if not matched:
                raise ValueError("INVALID_PROMO")

        discount_value = Decimal(str(promo.discount_value))
        # determine discount type
        is_percent = False
        try:
            if promo.discount_type == PromotionDiscountType.PERCENT:
                is_percent = True
            elif isinstance(promo.discount_type, str) and promo.discount_type == "PERCENT":
                is_percent = True
            elif str(promo.discount_type).upper() == "PERCENT":
                is_percent = True
        except Exception:
            is_percent = str(promo.discount_type).upper() == "PERCENT"

        if is_percent:
            base_for_promo = subtotal - passenger_discount
            if base_for_promo < Decimal("0.00"):
                base_for_promo = quantize(Decimal("0.00"))
            else:
                base_for_promo = quantize(base_for_promo)
            promo_discount = quantize(base_for_promo * discount_value / Decimal("100"))
        else:
            promo_discount = quantize(discount_value)

        # clamp promo_discount <= (subtotal - passenger_discount)
        max_promo = subtotal - passenger_discount
        if max_promo < Decimal("0.00"):
            max_promo = quantize(Decimal("0.00"))
        if promo_discount > max_promo:
            promo_discount = quantize(max_promo)
        if promo_discount < Decimal("0.00"):
            promo_discount = quantize(Decimal("0.00"))

    # 9. discount = passenger_discount + promo_discount, clamp <= subtotal
    discount = quantize(passenger_discount + promo_discount)
    if discount > subtotal:
        discount = quantize(subtotal)
    if discount < Decimal("0.00"):
        discount = quantize(Decimal("0.00"))

    taxable = quantize(subtotal - discount)
    if taxable < Decimal("0.00"):
        taxable = quantize(Decimal("0.00"))

    # 10. tax: VAT and other percent components
    tax = quantize(Decimal("0.00"))
    # fetch all percent components or at least VAT
    # generic: sum all active percent components
    res = await db.execute(select(FareComponent).where(FareComponent.is_percent == True, FareComponent.active == True))  # noqa: E712
    percent_components = res.scalars().all()
    # if no percent components found via that query (sqlite bool handling), fallback to VAT explicit
    if not percent_components:
        res = await db.execute(select(FareComponent).where(FareComponent.code == "VAT"))
        vat_one = res.scalar_one_or_none()
        if vat_one and vat_one.active and vat_one.is_percent and vat_one.percent is not None:
            percent_components = [vat_one]

    for comp in percent_components:
        # only apply if percent not null
        if comp.percent is None:
            continue
        # optional: only VAT? but spec says VAT, but include any percent active
        pct = Decimal(str(comp.percent))
        # tax component = taxable * pct /100
        comp_tax = quantize(taxable * pct / Decimal("100"))
        tax = quantize(tax + comp_tax)

    # also handle fixed tax components where is_percent false but code indicates tax? For this phase, only percent VAT is tax. Keep tax as computed.

    # 11. total = taxable + tax, max 0, quantize
    total = quantize(taxable + tax)
    if total < Decimal("0.00"):
        total = quantize(Decimal("0.00"))

    # ensure all fields quantized
    return FareBreakdown(
        base_fare=quantize(base_fare),
        accommodation_fee=quantize(accommodation_fee),
        terminal_fee=quantize(terminal_fee),
        service_fee=quantize(service_fee),
        tax=quantize(tax),
        discount=quantize(discount),
        vehicle_fee=quantize(vehicle_fee),
        total=quantize(total),
    )


# alias helper for quote consistency per brief
async def get_fare_breakdown_for_quote(
    db: AsyncSession,
    trip_id: str,
    accommodation_type_id: str,
    passenger_type_code: str,
    vehicle_type: Optional[str] = None,
    promo_code: Optional[str] = None,
) -> FareBreakdown:
    return await calculate_fare(db, trip_id, accommodation_type_id, passenger_type_code, vehicle_type, promo_code)
