from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.vessel import Vessel, VesselStatus
import uuid

async def create_vessel(db: AsyncSession, *, code: str, name: str, registration_number: str, capacity: int, vehicle_capacity: int = 0, status: str = "ACTIVE", active: bool = True) -> Vessel:
    existing = await db.execute(select(Vessel).where(Vessel.code == code))
    if existing.scalar_one_or_none():
        raise ValueError("CODE_EXISTS")
    existing2 = await db.execute(select(Vessel).where(Vessel.registration_number == registration_number))
    if existing2.scalar_one_or_none():
        raise ValueError("REGISTRATION_EXISTS")
    try:
        status_enum = VesselStatus(status)
    except ValueError:
        status_enum = VesselStatus.ACTIVE
    vessel = Vessel(
        id=str(uuid.uuid4()),
        code=code,
        name=name,
        registration_number=registration_number,
        capacity=capacity,
        vehicle_capacity=vehicle_capacity,
        status=status_enum,
        active=active,
    )
    db.add(vessel)
    await db.commit()
    await db.refresh(vessel)
    return vessel
