import strawberry
from sqlalchemy import select
from app.database.session import AsyncSessionLocal
from app.models.port import Port
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

@strawberry.type
class PortQuery:
    @strawberry.field
    async def ports(self, active: bool | None = None) -> list[PortType]:
        try:
            async with AsyncSessionLocal() as db:
                q = select(Port).order_by(Port.created_at)
                if active is not None:
                    q = q.where(Port.active == active)
                res = await db.execute(q)
                rows = res.scalars().all()
                return [_to_port_type(p) for p in rows]
        except Exception:
            return []

    @strawberry.field
    async def port(self, id: str) -> PortType | None:
        try:
            async with AsyncSessionLocal() as db:
                res = await db.execute(select(Port).where(Port.id == id))
                p = res.scalar_one_or_none()
                if not p:
                    return None
                return _to_port_type(p)
        except Exception:
            return None
