import strawberry
from sqlalchemy import select
from app.database.session import AsyncSessionLocal
from app.models.user import User
from app.graphql.types.user import UserType
from app.graphql.permissions import IsAuthenticated

def _to_user_type(u: User) -> UserType:
    return UserType(
        id=u.id,
        email=u.email,
        firstName=u.first_name,
        lastName=u.last_name,
        isActive=u.is_active,
        createdAt=u.created_at,
    )

@strawberry.type
class UserQuery:
    @strawberry.field(permission_classes=[IsAuthenticated])
    async def me(self, info: strawberry.Info) -> UserType | None:
        request = info.context["request"]
        payload = getattr(request.state, "user", None)
        if not payload:
            return None
        user_id = payload.get("sub")
        if not user_id:
            return None
        try:
            async with AsyncSessionLocal() as db:
                res = await db.execute(select(User).where(User.id == user_id))
                u = res.scalar_one_or_none()
                if not u:
                    return None
                return _to_user_type(u)
        except Exception:
            return None
