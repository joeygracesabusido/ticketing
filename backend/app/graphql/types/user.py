import strawberry
from datetime import datetime

@strawberry.type
class UserType:
    id: str
    email: str
    firstName: str
    lastName: str
    isActive: bool
    createdAt: datetime

@strawberry.type
class AuthPayload:
    accessToken: str
    refreshToken: str
    user: UserType
