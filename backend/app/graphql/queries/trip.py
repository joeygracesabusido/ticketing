import strawberry
import datetime
from sqlalchemy import select, func
from app.database.session import AsyncSessionLocal
from app.models.trip import Trip, TripSeat
from app.models.route import Route
from app.models.vessel import Vessel
from app.models.port import Port
from app.graphql.types.trip import TripType
from app.graphql.types.route import RouteType
from app.graphql.types.vessel import VesselType
from app.graphql.types.port import PortType

def _to_port_type(p: Port) -> PortType:
    return PortType(
        id=p.id,
        code=p.code,
        name=p.name,
        city=p.city,
        province=p.province,
        country=p.country,
        address=p.address,
        latitude=p.latitude,
        longitude=p.longitude,
        timezone=p.timezone,
        active=p.active,
        createdAt=p.created_at,
    )

def _to_route_type(r: Route) -> RouteType:
    return RouteType(
        id=r.id,
        code=r.code,
        originPort=_to_port_type(r.origin_port) if r.origin_port else None,  # type: ignore
        destinationPort=_to_port_type(r.destination_port) if r.destination_port else None,  # type: ignore
        distanceKm=r.distance_km,
        estimatedDurationMinutes=r.estimated_duration_minutes,
        active=r.active,
        createdAt=r.created_at,
    )

def _to_vessel_type(v: Vessel) -> VesselType:
    status_val = v.status.value if hasattr(v.status, "value") else str(v.status)
    return VesselType(
        id=v.id,
        code=v.code,
        name=v.name,
        registrationNumber=v.registration_number,
        capacity=v.capacity,
        vehicleCapacity=v.vehicle_capacity,
        status=status_val,
        active=v.active,
        createdAt=v.created_at,
    )

async def _fare_from(db, trip_id: str):
    try:
        res = await db.execute(select(func.min(TripSeat.price)).where(TripSeat.trip_id == trip_id))
        val = res.scalar()
        return val
    except Exception:
        return None

async def _build_trip_type(trip: Trip, db) -> TripType:
    # trip already has route and vessel joined
    route = trip.route
    vessel = trip.vessel
    # fetch departure/arrival ports
    dep_port = None
    arr_port = None
    try:
        dep_res = await db.execute(select(Port).where(Port.id == trip.departure_port_id))
        dep_port = dep_res.scalar_one_or_none()
        arr_res = await db.execute(select(Port).where(Port.id == trip.arrival_port_id))
        arr_port = arr_res.scalar_one_or_none()
    except Exception:
        pass
    fare = await _fare_from(db, trip.id)
    status_val = trip.status.value if hasattr(trip.status, "value") else str(trip.status)
    return TripType(
        id=trip.id,
        route=_to_route_type(route) if route else None,  # type: ignore
        vessel=_to_vessel_type(vessel) if vessel else None,  # type: ignore
        departurePort=_to_port_type(dep_port) if dep_port else None,  # type: ignore
        arrivalPort=_to_port_type(arr_port) if arr_port else None,  # type: ignore
        departureAt=trip.departure_at,
        arrivalAt=trip.arrival_at,
        status=status_val,
        bookingOpen=trip.booking_open,
        bookingClose=trip.booking_close,
        fareFrom=fare,
    )

@strawberry.type
class TripQuery:
    @strawberry.field
    async def searchTrips(
        self,
        originPortId: str,
        destinationPortId: str,
        departureDate: datetime.date,
    ) -> list[TripType]:
        try:
            async with AsyncSessionLocal() as db:
                # filter trips where route origin/destination matches and departure_at date matches
                # Use func.date for date comparison, works for postgres and sqlite
                q = (
                    select(Trip)
                    .join(Route, Trip.route_id == Route.id)
                    .where(Route.origin_port_id == originPortId)
                    .where(Route.destination_port_id == destinationPortId)
                    .where(func.date(Trip.departure_at) == departureDate.isoformat())
                    .order_by(Trip.departure_at)
                )
                res = await db.execute(q)
                trips = res.scalars().all()
                result = []
                for t in trips:
                    tt = await _build_trip_type(t, db)
                    result.append(tt)
                return result
        except Exception as e:
            # If DB unavailable, return empty
            return []

    @strawberry.field
    async def trip(self, id: str) -> TripType | None:
        try:
            async with AsyncSessionLocal() as db:
                res = await db.execute(select(Trip).where(Trip.id == id))
                t = res.scalar_one_or_none()
                if not t:
                    return None
                return await _build_trip_type(t, db)
        except Exception:
            return None
