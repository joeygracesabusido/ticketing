import strawberry
from decimal import Decimal
from graphql import GraphQLError
from sqlalchemy import select
from app.database.session import AsyncSessionLocal
from app.graphql.permissions import IsAuthenticated
from app.graphql.types.route import RouteType
from app.graphql.scalars import DecimalScalar
from app.services.route_service import create_route
from app.graphql.types.port import PortType
from app.models.route import Route

def _to_port_type(p):
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

def _to_route_type(r: Route) -> RouteType:
    return RouteType(
        id=r.id,
        code=r.code,
        originPort=_to_port_type(r.origin_port) if r.origin_port else None,  # type: ignore
        destinationPort=_to_port_type(r.destination_port) if r.destination_port else None,  # type: ignore
        distanceKm=r.distance_km,
        estimatedDurationMinutes=r.estimated_duration_minutes,
        active=r.active,
        createdAt=r.created_at,
    )

@strawberry.input
class CreateRouteInput:
    code: str
    originPortId: str
    destinationPortId: str
    distanceKm: DecimalScalar | None = None
    estimatedDurationMinutes: int | None = None
    active: bool | None = True

@strawberry.type
class RouteMutation:
    @strawberry.mutation(permission_classes=[IsAuthenticated])
    async def createRoute(self, info: strawberry.Info, input: CreateRouteInput) -> RouteType:
        request = info.context["request"]
        user = getattr(request.state, "user", None)
        if not user or "ADMIN" not in user.get("roles", []):
            raise GraphQLError("FORBIDDEN", extensions={"code": "FORBIDDEN"})
        async with AsyncSessionLocal() as db:
            try:
                route = await create_route(
                    db,
                    code=input.code,
                    origin_port_id=input.originPortId,
                    destination_port_id=input.destinationPortId,
                    distance_km=input.distanceKm,
                    estimated_duration_minutes=input.estimatedDurationMinutes,
                    active=input.active if input.active is not None else True,
                )
            except ValueError as e:
                raise GraphQLError(str(e), extensions={"code": str(e)})
            return _to_route_type(route)
