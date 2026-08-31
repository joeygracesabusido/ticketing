import uuid, datetime, enum
from decimal import Decimal
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Boolean, Numeric, DateTime, ForeignKey, Integer, Enum as SAEnum, func, JSON
from app.database.base import Base

class PromotionDiscountType(str, enum.Enum):
    PERCENT = "PERCENT"
    FIXED = "FIXED"

class FareComponent(Base):
    __tablename__ = "fare_components"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    code: Mapped[str] = mapped_column(String(30), unique=True)  # TERMINAL_FEE etc
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    amount: Mapped[Decimal | None] = mapped_column(Numeric(10,2), nullable=True)
    percent: Mapped[Decimal | None] = mapped_column(Numeric(5,2), nullable=True)
    is_percent: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class FareRule(Base):
    __tablename__ = "fare_rules"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    route_id: Mapped[str | None] = mapped_column(String, ForeignKey("routes.id"), nullable=True, index=True)
    vessel_id: Mapped[str | None] = mapped_column(String, ForeignKey("vessels.id"), nullable=True)
    accommodation_type_id: Mapped[str | None] = mapped_column(String, ForeignKey("accommodation_types.id"), nullable=True, index=True)
    passenger_type_id: Mapped[str | None] = mapped_column(String, ForeignKey("passenger_types.id"), nullable=True, index=True)
    base_fare: Mapped[Decimal] = mapped_column(Numeric(10,2))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    valid_from: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    valid_to: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class Promotion(Base):
    __tablename__ = "promotions"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    code: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    discount_type: Mapped[PromotionDiscountType] = mapped_column(SAEnum(PromotionDiscountType, name="promotion_discount_type"))
    discount_value: Mapped[Decimal] = mapped_column(Numeric(10,2))
    max_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    used_count: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    valid_from: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    valid_to: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    min_passengers: Mapped[int] = mapped_column(Integer, default=1)
    created_at = mapped_column(DateTime(timezone=True), server_default=func.now())

class PromotionRule(Base):
    __tablename__ = "promotion_rules"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    promotion_id: Mapped[str] = mapped_column(String, ForeignKey("promotions.id", ondelete="CASCADE"), index=True)
    route_id: Mapped[str | None] = mapped_column(String, ForeignKey("routes.id"), nullable=True)
    accommodation_type_id: Mapped[str | None] = mapped_column(String, ForeignKey("accommodation_types.id"), nullable=True)
    passenger_type_id: Mapped[str | None] = mapped_column(String, ForeignKey("passenger_types.id"), nullable=True)
    created_at = mapped_column(DateTime(timezone=True), server_default=func.now())

class VehicleFareRule(Base):
    __tablename__ = "vehicle_fare_rules"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    vehicle_type: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    base_fee: Mapped[Decimal] = mapped_column(Numeric(10,2))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at = mapped_column(DateTime(timezone=True), server_default=func.now())
