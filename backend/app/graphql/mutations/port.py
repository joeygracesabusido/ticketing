import strawberry
from decimal import Decimal
from graphql import GraphQLError
from app.database.session import AsyncSessionLocal
from app.graphql.permissions import IsAuthenticated
from app.graphql.types.port import PortType
from app.graphql.scalars import DecimalScalar
from app.services.port_service import create_port
from app.models.port import Port

@strawberry.input
class CreatePortInput:
    code: str
    name: str
    city: str
    province: str
    country: str | None = "Philippines"
    address: str | None = None
    latitude: DecimalScalar | None = None
    longitude: DecimalScalar | None = None
    timezone: str | None = "Asia/Manila"
    active: bool | None = True

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
class PortMutation:
    @strawberry.mutation(permission_classes=[IsAuthenticated])
    async def createPort(self, info: strawberry.Info, input: CreatePortInput) -> PortType:
        request = info.context["request"]
        user = getattr(request.state, "user", None)
        if not user or "ADMIN" not in user.get("roles", []):
            raise GraphQLError("FORBIDDEN", extensions={"code": "FORBIDDEN"})
        # need to handle Decimal parsing: input.latitude may be Decimal via scalar, but we treat as Decimal
        async with AsyncSessionLocal() as db:
            try:
                port = await create_port(
                    db,
                    code=input.code,
                    name=input.name,
                    city=input.city,
                    province=input.province,
                    country=input.country or "Philippines",
                    address=input.address,
                    latitude=input.latitude,  # type: ignore
                    longitude=input.longitude,  # type: ignore
                    timezone=input.timezone or "Asia/Manila",
                    active=input.active if input.active is not None else True,
                )
            except ValueError as e:
                raise GraphQLError(str(e), extensions={"code": str(e)})
            return _to_port_type(port)
