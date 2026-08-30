from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.user import User, Role
from app.utils.security import hash_password, verify_password, create_access_token, create_refresh_token
import uuid

async def register(db: AsyncSession, email: str, password: str, first_name: str, last_name: str):
    existing = await db.execute(select(User).where(User.email==email))
    if existing.scalar_one_or_none(): raise ValueError("EMAIL_EXISTS")
    user = User(id=str(uuid.uuid4()), email=email, password_hash=hash_password(password), first_name=first_name, last_name=last_name)
    # assign CUSTOMER role
    role = (await db.execute(select(Role).where(Role.code=="CUSTOMER"))).scalar_one_or_none()
    if role: user.roles.append(role)
    db.add(user); await db.commit(); await db.refresh(user); return user

async def authenticate(db: AsyncSession, email: str, password: str):
    res = await db.execute(select(User).where(User.email==email))
    user = res.scalar_one_or_none()
    if not user or not verify_password(password, user.password_hash): raise ValueError("INVALID_CREDENTIALS")
    return user

def tokens_for_user(user: User):
    roles = [r.code for r in user.roles]
    payload = {"sub": user.id, "email": user.email, "roles": roles}
    return create_access_token(payload), create_refresh_token({"sub": user.id})
