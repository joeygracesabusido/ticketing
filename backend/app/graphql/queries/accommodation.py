import strawberry
from sqlalchemy import select
from app.database.session import AsyncSessionLocal
from app.models.accommodation import AccommodationType as AccommodationModel
from app.graphql.types.accommodation import AccommodationType

def _to_accom_type(a: AccommodationModel) -> AccommodationType:
    return AccommodationType(
        id=a.id,
        code=a.code,
        name=a.name,
        description=a.description,
        capacity=a.capacity,
        basePrice=a.base_price,
        active=a.active,
        createdAt=a.created_at,
    )

@strawberry.type
class AccommodationQuery:
    @strawberry.field
    async def accommodationTypes(self, active: bool | None = None) -> list[AccommodationType]:
        try:
            async with AsyncSessionLocal() as db:
                q = select(AccommodationModel).order_by(AccommodationModel.created_at)
                if active is not None:
                    q = q.where(AccommodationModel.active == active)
                res = await db.execute(q)
                rows = res.scalars().all()
                return [_to_accom_type(a) for a in rows]
        except Exception:
            return []

    @strawberry.field
    async def accommodationType(self, id: str) -> AccommodationType | None:
        try:
            async with AsyncSessionLocal() as db:
                res = await db.execute(select(AccommodationModel).where(AccommodationModel.id == id))
                a = res.scalar_one_or_none()
                if not a:
                    return None
                return _to_accom_type(a)
        except Exception:
            return None
