import strawberry
from datetime import datetime

@strawberry.type
class VesselType:
    id: str
    code: str
    name: str
    registrationNumber: str
    capacity: int
    vehicleCapacity: int
    status: str
    active: bool
    createdAt: datetime
