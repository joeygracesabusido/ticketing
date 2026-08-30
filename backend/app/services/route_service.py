from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.route import Route
from app.models.port import Port
import uuid
from decimal import Decimal

async def create_route(db: AsyncSession, *, code: str, origin_port_id: str, destination_port_id: str, distance_km: Decimal | None = None, estimated_duration_minutes: int | None = None, active: bool = True) -> Route:
    existing = await db.execute(select(Route).where(Route.code == code))
    if existing.scalar_one_or_none():
        raise ValueError("CODE_EXISTS")
    # validate ports exist
    for pid in (origin_port_id, destination_port_id):
        res = await db.execute(select(Port).where(Port.id == pid))
        if not res.scalar_one_or_none():
            raise ValueError("PORT_NOT_FOUND")
    if origin_port_id == destination_port_id:
        raise ValueError("SAME_PORT")
    route = Route(
        id=str(uuid.uuid4()),
        code=code,
        origin_port_id=origin_port_id,
        destination_port_id=destination_port_id,
        distance_km=distance_km,
        estimated_duration_minutes=estimated_duration_minutes,
        active=active,
    )
    db.add(route)
    await db.commit()
    await db.refresh(route)
    # reload with relationships
    await db.refresh(route, attribute_names=["origin_port", "destination_port"])
    return route
