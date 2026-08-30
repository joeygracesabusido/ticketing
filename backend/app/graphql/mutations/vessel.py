import strawberry
from graphql import GraphQLError
from app.database.session import AsyncSessionLocal
from app.graphql.permissions import IsAuthenticated
from app.graphql.types.vessel import VesselType
from app.services.vessel_service import create_vessel
from app.models.vessel import Vessel

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

@strawberry.input
class CreateVesselInput:
    code: str
    name: str
    registrationNumber: str
    capacity: int
    vehicleCapacity: int | None = 0
    status: str | None = "ACTIVE"
    active: bool | None = True

@strawberry.type
class VesselMutation:
    @strawberry.mutation(permission_classes=[IsAuthenticated])
    async def createVessel(self, info: strawberry.Info, input: CreateVesselInput) -> VesselType:
        request = info.context["request"]
        user = getattr(request.state, "user", None)
        if not user or "ADMIN" not in user.get("roles", []):
            raise GraphQLError("FORBIDDEN", extensions={"code": "FORBIDDEN"})
        async with AsyncSessionLocal() as db:
            try:
                vessel = await create_vessel(
                    db,
                    code=input.code,
                    name=input.name,
                    registration_number=input.registrationNumber,
                    capacity=input.capacity,
                    vehicle_capacity=input.vehicleCapacity if input.vehicleCapacity is not None else 0,
                    status=input.status or "ACTIVE",
                    active=input.active if input.active is not None else True,
                )
            except ValueError as e:
                raise GraphQLError(str(e), extensions={"code": str(e)})
            return _to_vessel_type(vessel)
