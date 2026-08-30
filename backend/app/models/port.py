import uuid
import datetime
from decimal import Decimal
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Boolean, DateTime, Numeric, func
from app.database.base import Base


class Port(Base):
    __tablename__ = "ports"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    city: Mapped[str] = mapped_column(String(100), nullable=False)
    province: Mapped[str] = mapped_column(String(100), nullable=False)
    country: Mapped[str] = mapped_column(
        String(100), nullable=False, default="Philippines", server_default="Philippines"
    )
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    latitude: Mapped[Decimal | None] = mapped_column(Numeric(10, 6), nullable=True)
    longitude: Mapped[Decimal | None] = mapped_column(Numeric(10, 6), nullable=True)
    timezone: Mapped[str] = mapped_column(
        String(50), nullable=False, default="Asia/Manila", server_default="Asia/Manila"
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
