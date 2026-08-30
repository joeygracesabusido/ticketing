import strawberry
from datetime import datetime
from app.graphql.scalars import DecimalScalar
from app.graphql.types.route import RouteType
from app.graphql.types.vessel import VesselType
from app.graphql.types.port import PortType

@strawberry.type
class TripType:
    id: str
    route: RouteType
    vessel: VesselType
    departurePort: PortType
    arrivalPort: PortType
    departureAt: datetime
    arrivalAt: datetime
    status: str
    bookingOpen: datetime | None
    bookingClose: datetime | None
    fareFrom: DecimalScalar | None
