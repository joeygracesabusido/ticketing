from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.port import Port
import uuid
from decimal import Decimal

async def create_port(db: AsyncSession, *, code: str, name: str, city: str, province: str, country: str = "Philippines", address: str | None = None, latitude: Decimal | None = None, longitude: Decimal | None = None, timezone: str = "Asia/Manila", active: bool = True) -> Port:
    existing = await db.execute(select(Port).where(Port.code == code))
    if existing.scalar_one_or_none():
        raise ValueError("CODE_EXISTS")
    port = Port(
        id=str(uuid.uuid4()),
        code=code,
        name=name,
        city=city,
        province=province,
        country=country,
        address=address,
        latitude=latitude,
        longitude=longitude,
        timezone=timezone,
        active=active,
    )
    db.add(port)
    await db.commit()
    await db.refresh(port)
    return port
