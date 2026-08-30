import strawberry
from decimal import Decimal
from datetime import datetime
from app.graphql.scalars import DecimalScalar

@strawberry.type
class PortType:
    id: str
    code: str
    name: str
    city: str
    province: str
    country: str
    address: str | None
    latitude: DecimalScalar | None
    longitude: DecimalScalar | None
    timezone: str
    active: bool
    createdAt: datetime
