import strawberry
from sqlalchemy import select
from sqlalchemy.orm import selectinload, joinedload
from app.database.session import AsyncSessionLocal
from app.models.route import Route
from app.models.port import Port
from app.graphql.types.route import RouteType
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
    # relationship origin_port / destination_port are joined eagerly
    origin = r.origin_port
    dest = r.destination_port
    return RouteType(
        id=r.id,
        code=r.code,
        originPort=_to_port_type(origin) if origin else None,  # type: ignore
        destinationPort=_to_port_type(dest) if dest else None,  # type: ignore
        distanceKm=r.distance_km,
        estimatedDurationMinutes=r.estimated_duration_minutes,
        active=r.active,
        createdAt=r.created_at,
    )

@strawberry.type
class RouteQuery:
    @strawberry.field
    async def routes(self, active: bool | None = None) -> list[RouteType]:
        try:
            async with AsyncSessionLocal() as db:
                q = select(Route).order_by(Route.created_at)
                if active is not None:
                    q = q.where(Route.active == active)
                res = await db.execute(q)
                rows = res.scalars().all()
                return [_to_route_type(r) for r in rows]
        except Exception:
            return []

    @strawberry.field
    async def route(self, id: str) -> RouteType | None:
        try:
            async with AsyncSessionLocal() as db:
                res = await db.execute(select(Route).where(Route.id == id))
                r = res.scalar_one_or_none()
                if not r:
                    return None
                return _to_route_type(r)
        except Exception:
            return None
