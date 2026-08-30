import strawberry
import datetime
from graphql import GraphQLError
from sqlalchemy import select, func
from app.database.session import AsyncSessionLocal
from app.graphql.permissions import IsAuthenticated
from app.graphql.types.trip import TripType
from app.graphql.types.route import RouteType
from app.graphql.types.vessel import VesselType
from app.graphql.types.port import PortType
from app.models.trip import Trip, TripSeat
from app.models.port import Port
from app.services.trip_service import create_trip

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

def _to_route_type(r):
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

def _to_vessel_type(v):
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
        return res.scalar()
    except Exception:
        return None

async def _build_trip_type(trip: Trip, db) -> TripType:
    route = trip.route
    vessel = trip.vessel
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

@strawberry.input
class CreateTripInput:
    routeId: str
    vesselId: str
    departurePortId: str
    arrivalPortId: str
    departureAt: datetime.datetime
    arrivalAt: datetime.datetime
    status: str | None = "SCHEDULED"
    bookingOpen: datetime.datetime | None = None
    bookingClose: datetime.datetime | None = None

@strawberry.type
class TripMutation:
    @strawberry.mutation(permission_classes=[IsAuthenticated])
    async def createTrip(self, info: strawberry.Info, input: CreateTripInput) -> TripType:
        request = info.context["request"]
        user = getattr(request.state, "user", None)
        if not user or "ADMIN" not in user.get("roles", []):
            raise GraphQLError("FORBIDDEN", extensions={"code": "FORBIDDEN"})
        async with AsyncSessionLocal() as db:
            try:
                trip = await create_trip(
                    db,
                    route_id=input.routeId,
                    vessel_id=input.vesselId,
                    departure_port_id=input.departurePortId,
                    arrival_port_id=input.arrivalPortId,
                    departure_at=input.departureAt,
                    arrival_at=input.arrivalAt,
                    status=input.status or "SCHEDULED",
                    booking_open=input.bookingOpen,
                    booking_close=input.bookingClose,
                )
            except ValueError as e:
                raise GraphQLError(str(e), extensions={"code": str(e)})
            return await _build_trip_type(trip, db)
