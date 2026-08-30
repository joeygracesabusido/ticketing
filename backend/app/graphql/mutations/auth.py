import strawberry
from graphql import GraphQLError
from sqlalchemy import select
from app.database.session import AsyncSessionLocal
from app.models.user import User
from app.services.auth_service import register as register_service, authenticate as authenticate_service, tokens_for_user
from app.graphql.types.user import UserType, AuthPayload
from app.utils.security import decode_token

def _to_user_type(u: User) -> UserType:
    return UserType(
        id=u.id,
        email=u.email,
        firstName=u.first_name,
        lastName=u.last_name,
        isActive=u.is_active,
        createdAt=u.created_at,
    )

@strawberry.input
class RegisterInput:
    email: str
    password: str
    firstName: str
    lastName: str

@strawberry.type
class AuthMutation:
    @strawberry.mutation
    async def register(self, input: RegisterInput) -> AuthPayload:
        async with AsyncSessionLocal() as db:
            try:
                user = await register_service(db, email=input.email, password=input.password, first_name=input.firstName, last_name=input.lastName)
            except ValueError as e:
                raise GraphQLError(str(e), extensions={"code": str(e)})
            # user already has roles loaded via selectin
            access, refresh = tokens_for_user(user)
            return AuthPayload(accessToken=access, refreshToken=refresh, user=_to_user_type(user))

    @strawberry.mutation
    async def login(self, email: str, password: str) -> AuthPayload:
        async with AsyncSessionLocal() as db:
            try:
                user = await authenticate_service(db, email=email, password=password)
            except ValueError as e:
                raise GraphQLError(str(e), extensions={"code": str(e)})
            access, refresh = tokens_for_user(user)
            return AuthPayload(accessToken=access, refreshToken=refresh, user=_to_user_type(user))

    @strawberry.mutation
    async def refreshToken(self, refreshToken: str) -> AuthPayload:
        try:
            payload = decode_token(refreshToken, refresh=True)
        except Exception:
            raise GraphQLError("INVALID_TOKEN", extensions={"code": "INVALID_TOKEN"})
        user_id = payload.get("sub")
        if not user_id:
            raise GraphQLError("INVALID_TOKEN", extensions={"code": "INVALID_TOKEN"})
        async with AsyncSessionLocal() as db:
            res = await db.execute(select(User).where(User.id == user_id))
            user = res.scalar_one_or_none()
            if not user:
                raise GraphQLError("USER_NOT_FOUND", extensions={"code": "USER_NOT_FOUND"})
            access, refresh = tokens_for_user(user)
            return AuthPayload(accessToken=access, refreshToken=refresh, user=_to_user_type(user))
