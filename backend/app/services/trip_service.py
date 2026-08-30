from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.trip import Trip, TripStatus
from app.models.route import Route
from app.models.vessel import Vessel
from app.models.port import Port
import uuid
import datetime

async def create_trip(db: AsyncSession, *, route_id: str, vessel_id: str, departure_port_id: str, arrival_port_id: str, departure_at: datetime.datetime, arrival_at: datetime.datetime, status: str = "SCHEDULED", booking_open: datetime.datetime | None = None, booking_close: datetime.datetime | None = None) -> Trip:
    # validate foreign keys
    for model, fid, name in [(Route, route_id, "ROUTE_NOT_FOUND"), (Vessel, vessel_id, "VESSEL_NOT_FOUND"), (Port, departure_port_id, "PORT_NOT_FOUND"), (Port, arrival_port_id, "PORT_NOT_FOUND")]:
        res = await db.execute(select(model).where(model.id == fid))
        if not res.scalar_one_or_none():
            raise ValueError(name)
    if departure_at >= arrival_at:
        raise ValueError("INVALID_TIME")
    try:
        status_enum = TripStatus(status)
    except ValueError:
        status_enum = TripStatus.SCHEDULED
    trip = Trip(
        id=str(uuid.uuid4()),
        route_id=route_id,
        vessel_id=vessel_id,
        departure_port_id=departure_port_id,
        arrival_port_id=arrival_port_id,
        departure_at=departure_at,
        arrival_at=arrival_at,
        status=status_enum,
        booking_open=booking_open,
        booking_close=booking_close,
    )
    db.add(trip)
    await db.commit()
    await db.refresh(trip)
    # ensure route/vessel relationships loaded
    await db.refresh(trip, attribute_names=["route", "vessel"])
    return trip
