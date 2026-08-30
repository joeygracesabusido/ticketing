import strawberry
from datetime import datetime
from decimal import Decimal
from app.graphql.scalars import DecimalScalar
from app.graphql.types.port import PortType

@strawberry.type
class RouteType:
    id: str
    code: str
    originPort: PortType
    destinationPort: PortType
    distanceKm: DecimalScalar | None
    estimatedDurationMinutes: int | None
    active: bool
    createdAt: datetime
