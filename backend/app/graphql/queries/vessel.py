import strawberry
from sqlalchemy import select
from app.database.session import AsyncSessionLocal
from app.models.vessel import Vessel
from app.graphql.types.vessel import VesselType

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

@strawberry.type
class VesselQuery:
    @strawberry.field
    async def vessels(self, active: bool | None = None) -> list[VesselType]:
        try:
            async with AsyncSessionLocal() as db:
                q = select(Vessel).order_by(Vessel.created_at)
                if active is not None:
                    q = q.where(Vessel.active == active)
                res = await db.execute(q)
                rows = res.scalars().all()
                return [_to_vessel_type(v) for v in rows]
        except Exception:
            return []

    @strawberry.field
    async def vessel(self, id: str) -> VesselType | None:
        try:
            async with AsyncSessionLocal() as db:
                res = await db.execute(select(Vessel).where(Vessel.id == id))
                v = res.scalar_one_or_none()
                if not v:
                    return None
                return _to_vessel_type(v)
        except Exception:
            return None


