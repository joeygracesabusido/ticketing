import strawberry
from app.graphql.queries.port import PortQuery
from app.graphql.queries.route import RouteQuery
from app.graphql.queries.vessel import VesselQuery
from app.graphql.queries.trip import TripQuery
from app.graphql.queries.accommodation import AccommodationQuery
from app.graphql.queries.user import UserQuery
from app.graphql.mutations.auth import AuthMutation
from app.graphql.mutations.port import PortMutation
from app.graphql.mutations.route import RouteMutation
from app.graphql.mutations.vessel import VesselMutation
from app.graphql.mutations.trip import TripMutation

@strawberry.type
class Query(PortQuery, RouteQuery, VesselQuery, TripQuery, AccommodationQuery, UserQuery):
    pass

@strawberry.type
class Mutation(AuthMutation, PortMutation, RouteMutation, VesselMutation, TripMutation):
    pass

schema = strawberry.Schema(query=Query, mutation=Mutation)
