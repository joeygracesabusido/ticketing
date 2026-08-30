import uuid
import enum
import datetime
from decimal import Decimal
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Boolean, DateTime, Integer, ForeignKey, Numeric, Enum as SAEnum, func, UniqueConstraint, Index
from app.database.base import Base


class TripStatus(str, enum.Enum):
    SCHEDULED = "SCHEDULED"
    BOARDING = "BOARDING"
    DEPARTED = "DEPARTED"
    ARRIVED = "ARRIVED"
    CANCELLED = "CANCELLED"
    DELAYED = "DELAYED"
    COMPLETED = "COMPLETED"


class TripSeatStatus(str, enum.Enum):
    AVAILABLE = "AVAILABLE"
    HELD = "HELD"
    RESERVED = "RESERVED"
    OCCUPIED = "OCCUPIED"
    BLOCKED = "BLOCKED"


class TripVehicleType(str, enum.Enum):
    MOTORCYCLE = "MOTORCYCLE"
    CAR = "CAR"
    VAN = "VAN"
    TRUCK = "TRUCK"
    BUS = "BUS"


class Trip(Base):
    __tablename__ = "trips"
    __table_args__ = (
        Index("ix_trips_route_vessel", "route_id", "vessel_id"),
        Index("ix_trips_departure_at", "departure_at"),
        Index("ix_trips_status", "status"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    route_id: Mapped[str] = mapped_column(
        String, ForeignKey("routes.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    vessel_id: Mapped[str] = mapped_column(
        String, ForeignKey("vessels.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    departure_port_id: Mapped[str] = mapped_column(
        String, ForeignKey("ports.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    arrival_port_id: Mapped[str] = mapped_column(
        String, ForeignKey("ports.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    departure_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    arrival_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[TripStatus] = mapped_column(
        SAEnum(TripStatus, name="trip_status"), nullable=False, default=TripStatus.SCHEDULED, server_default="SCHEDULED"
    )
    booking_open: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    booking_close: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    route = relationship("Route", lazy="joined")
    vessel = relationship("Vessel", lazy="joined")


class TripSeat(Base):
    __tablename__ = "trip_seats"
    __table_args__ = (
        UniqueConstraint("trip_id", "seat_number", name="uq_trip_seats_trip_seat_number"),
        Index("ix_trip_seats_trip_status_accommodation", "trip_id", "status", "accommodation_type_id"),
        Index("ix_trip_seats_trip_id", "trip_id"),
        Index("ix_trip_seats_status", "status"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    trip_id: Mapped[str] = mapped_column(
        String, ForeignKey("trips.id", ondelete="CASCADE"), nullable=False
    )
    vessel_seat_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("vessel_seats.id", ondelete="SET NULL"), nullable=True
    )
    seat_number: Mapped[str] = mapped_column(String(20), nullable=False)
    accommodation_type_id: Mapped[str] = mapped_column(
        String, ForeignKey("accommodation_types.id", ondelete="RESTRICT"), nullable=False
    )
    status: Mapped[TripSeatStatus] = mapped_column(
        SAEnum(TripSeatStatus, name="trip_seat_status"), nullable=False, default=TripSeatStatus.AVAILABLE, server_default="AVAILABLE"
    )
    hold_expires_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    booking_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class TripVehicleSlot(Base):
    __tablename__ = "trip_vehicle_slots"
    __table_args__ = (
        Index("ix_trip_vehicle_slots_trip_id", "trip_id"),
        UniqueConstraint("trip_id", "slot_number", name="uq_trip_vehicle_slots_trip_slot"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    trip_id: Mapped[str] = mapped_column(
        String, ForeignKey("trips.id", ondelete="CASCADE"), nullable=False
    )
    slot_number: Mapped[str] = mapped_column(String(20), nullable=False)
    vehicle_type: Mapped[TripVehicleType] = mapped_column(
        SAEnum(TripVehicleType, name="trip_vehicle_type"), nullable=False, default=TripVehicleType.CAR
    )
    status: Mapped[TripSeatStatus] = mapped_column(
        SAEnum(TripSeatStatus, name="trip_vehicle_slot_status"), nullable=False, default=TripSeatStatus.AVAILABLE, server_default="AVAILABLE"
    )
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    booking_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    hold_expires_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
