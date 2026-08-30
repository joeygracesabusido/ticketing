import uuid
import enum
import datetime
from decimal import Decimal
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Boolean, DateTime, Integer, ForeignKey, Numeric, Enum as SAEnum, func, UniqueConstraint, Index
from app.database.base import Base


class VesselStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    MAINTENANCE = "MAINTENANCE"
    INACTIVE = "INACTIVE"
    RETIRED = "RETIRED"


class SeatStatus(str, enum.Enum):
    AVAILABLE = "AVAILABLE"
    HELD = "HELD"
    RESERVED = "RESERVED"
    OCCUPIED = "OCCUPIED"
    BLOCKED = "BLOCKED"


class VehicleType(str, enum.Enum):
    MOTORCYCLE = "MOTORCYCLE"
    CAR = "CAR"
    VAN = "VAN"
    TRUCK = "TRUCK"
    BUS = "BUS"


class Vessel(Base):
    __tablename__ = "vessels"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    code: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    registration_number: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    vehicle_capacity: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    status: Mapped[VesselStatus] = mapped_column(
        SAEnum(VesselStatus, name="vessel_status"), nullable=False, default=VesselStatus.ACTIVE, server_default="ACTIVE"
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    decks: Mapped[list["VesselDeck"]] = relationship(back_populates="vessel", cascade="all, delete-orphan", lazy="selectin")


class VesselDeck(Base):
    __tablename__ = "vessel_decks"
    __table_args__ = (
        Index("ix_vessel_decks_vessel_order", "vessel_id", "deck_order"),
        UniqueConstraint("vessel_id", "deck_order", name="uq_vessel_decks_vessel_order"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    vessel_id: Mapped[str] = mapped_column(
        String, ForeignKey("vessels.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    deck_order: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    vessel: Mapped[Vessel] = relationship(back_populates="decks")
    sections: Mapped[list["VesselSection"]] = relationship(back_populates="deck", cascade="all, delete-orphan", lazy="selectin")


class VesselSection(Base):
    __tablename__ = "vessel_sections"
    __table_args__ = (
        Index("ix_vessel_sections_deck", "deck_id"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    deck_id: Mapped[str] = mapped_column(
        String, ForeignKey("vessel_decks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    accommodation_type_id: Mapped[str] = mapped_column(
        String, ForeignKey("accommodation_types.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    deck: Mapped[VesselDeck] = relationship(back_populates="sections")
    seats: Mapped[list["VesselSeat"]] = relationship(back_populates="section", cascade="all, delete-orphan", lazy="selectin")
    vehicle_slots: Mapped[list["VesselVehicleSlot"]] = relationship(back_populates="section", cascade="all, delete-orphan", lazy="selectin")


class VesselSeat(Base):
    __tablename__ = "vessel_seats"
    __table_args__ = (
        Index("ix_vessel_seats_section_number", "section_id", "seat_number"),
        UniqueConstraint("section_id", "seat_number", name="uq_vessel_seats_section_seat"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    section_id: Mapped[str] = mapped_column(
        String, ForeignKey("vessel_sections.id", ondelete="CASCADE"), nullable=False, index=True
    )
    seat_number: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[SeatStatus] = mapped_column(
        SAEnum(SeatStatus, name="vessel_seat_status"), nullable=False, default=SeatStatus.AVAILABLE, server_default="AVAILABLE"
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    section: Mapped[VesselSection] = relationship(back_populates="seats")


class VesselVehicleSlot(Base):
    __tablename__ = "vessel_vehicle_slots"
    __table_args__ = (
        Index("ix_vessel_vehicle_slots_section_number", "section_id", "slot_number"),
        UniqueConstraint("section_id", "slot_number", name="uq_vessel_vehicle_slots_section_slot"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    section_id: Mapped[str] = mapped_column(
        String, ForeignKey("vessel_sections.id", ondelete="CASCADE"), nullable=False, index=True
    )
    slot_number: Mapped[str] = mapped_column(String(20), nullable=False)
    vehicle_type: Mapped[VehicleType] = mapped_column(
        SAEnum(VehicleType, name="vessel_vehicle_type"), nullable=False, default=VehicleType.CAR
    )
    status: Mapped[SeatStatus] = mapped_column(
        SAEnum(SeatStatus, name="vessel_vehicle_slot_status"), nullable=False, default=SeatStatus.AVAILABLE, server_default="AVAILABLE"
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    section: Mapped[VesselSection] = relationship(back_populates="vehicle_slots")
