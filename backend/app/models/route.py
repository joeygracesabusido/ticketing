import uuid
import datetime
from decimal import Decimal
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Boolean, DateTime, Numeric, Integer, ForeignKey, UniqueConstraint, Index, func
from app.database.base import Base


class Route(Base):
    __tablename__ = "routes"
    __table_args__ = (
        Index("ix_routes_origin_destination", "origin_port_id", "destination_port_id"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    code: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    origin_port_id: Mapped[str] = mapped_column(
        String, ForeignKey("ports.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    destination_port_id: Mapped[str] = mapped_column(
        String, ForeignKey("ports.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    distance_km: Mapped[Decimal | None] = mapped_column(Numeric(10, 2), nullable=True)
    estimated_duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    origin_port = relationship("Port", foreign_keys=[origin_port_id], lazy="joined")
    destination_port = relationship("Port", foreign_keys=[destination_port_id], lazy="joined")


class RouteStop(Base):
    __tablename__ = "route_stops"
    __table_args__ = (
        UniqueConstraint("route_id", "stop_order", name="uq_route_stops_route_stop_order"),
        UniqueConstraint("route_id", "port_id", name="uq_route_stops_route_port"),
        Index("ix_route_stops_route_stop_order", "route_id", "stop_order"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    route_id: Mapped[str] = mapped_column(
        String, ForeignKey("routes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    port_id: Mapped[str] = mapped_column(
        String, ForeignKey("ports.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    stop_order: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
