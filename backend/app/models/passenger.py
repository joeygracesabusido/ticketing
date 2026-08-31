import uuid, datetime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Boolean, Numeric, DateTime, func
from app.database.base import Base

class PassengerType(Base):
    __tablename__ = "passenger_types"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True)  # ADULT etc
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    discount_percent: Mapped[float] = mapped_column(Numeric(5,2), default=0)  # use Decimal in python
    requires_id: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
