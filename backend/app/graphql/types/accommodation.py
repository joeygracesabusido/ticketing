import strawberry
from datetime import datetime
from app.graphql.scalars import DecimalScalar

@strawberry.type
class AccommodationType:
    id: str
    code: str
    name: str
    description: str | None
    capacity: int | None
    basePrice: DecimalScalar
    active: bool
    createdAt: datetime
