from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, JSON, String, UniqueConstraint
from sqlalchemy.orm import relationship

from .db import Base, generate_id, now


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=generate_id)
    provider = Column(String, nullable=False)
    provider_user_id = Column(String, nullable=False)
    display_name = Column(String, nullable=False)
    created_at = Column(DateTime, default=now, nullable=False)

    __table_args__ = (UniqueConstraint("provider", "provider_user_id", name="uq_provider_user"),)

    photos = relationship("TrashPhoto", back_populates="user", cascade="all, delete-orphan")
    coupons = relationship("Coupon", back_populates="user", cascade="all, delete-orphan")
    summaries = relationship("UserDailySummary", back_populates="user", cascade="all, delete-orphan")
    bin_scans = relationship("BinScan", back_populates="user", cascade="all, delete-orphan")


class Festival(Base):
    __tablename__ = "festivals"

    id = Column(String, primary_key=True, default=generate_id)
    name = Column(String, nullable=False)
    budget = Column(Integer, nullable=False)
    per_user_daily_cap = Column(Integer, nullable=False)
    per_photo_point = Column(Integer, nullable=False)
    center_lat = Column(Float)
    center_lng = Column(Float)
    radius_meters = Column(Integer, default=1000)
    created_at = Column(DateTime, default=now, nullable=False)

    trash_bins = relationship("TrashBin", back_populates="festival", cascade="all, delete-orphan")
    photos = relationship("TrashPhoto", back_populates="festival", cascade="all, delete-orphan")
    summaries = relationship("UserDailySummary", back_populates="festival", cascade="all, delete-orphan")
    coupons = relationship("Coupon", back_populates="festival", cascade="all, delete-orphan")
    bin_scans = relationship("BinScan", back_populates="festival", cascade="all, delete-orphan")


class TrashPhoto(Base):
    __tablename__ = "trash_photos"

    id = Column(String, primary_key=True, default=generate_id)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    festival_id = Column(String, ForeignKey("festivals.id"), nullable=False)
    image_url = Column(String, nullable=False)
    hash = Column(String, nullable=False)
    status = Column(String, default="PENDING", nullable=False)
    points = Column(Integer, nullable=False)
    has_trash = Column(Boolean)
    trash_count = Column(Integer)
    max_trash_confidence = Column(Float)
    yolo_raw = Column(JSON)
    created_at = Column(DateTime, default=now, nullable=False)

    user = relationship("User", back_populates="photos")
    festival = relationship("Festival", back_populates="photos")


class TrashBin(Base):
    __tablename__ = "trash_bins"

    id = Column(String, primary_key=True, default=generate_id)
    festival_id = Column(String, ForeignKey("festivals.id"), nullable=False)
    code = Column(String, unique=True, nullable=False)
    name = Column(String, nullable=False)
    description = Column(String)
    latitude = Column(Float)
    longitude = Column(Float)
    created_at = Column(DateTime, default=now, nullable=False)

    festival = relationship("Festival", back_populates="trash_bins")
    scans = relationship("BinScan", back_populates="bin", cascade="all, delete-orphan")


class UserDailySummary(Base):
    __tablename__ = "user_daily_summaries"

    id = Column(String, primary_key=True, default=generate_id)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    festival_id = Column(String, ForeignKey("festivals.id"), nullable=False)
    date = Column(String, nullable=False)
    total_pending = Column(Integer, default=0, nullable=False)
    total_active = Column(Integer, default=0, nullable=False)
    total_consumed = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=now, nullable=False)

    __table_args__ = (UniqueConstraint("user_id", "festival_id", "date", name="uq_summary_day"),)

    user = relationship("User", back_populates="summaries")
    festival = relationship("Festival", back_populates="summaries")


class Coupon(Base):
    __tablename__ = "coupons"

    id = Column(String, primary_key=True, default=generate_id)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    festival_id = Column(String, ForeignKey("festivals.id"), nullable=False)
    shop_name = Column(String, nullable=False)
    amount = Column(Integer, nullable=False)
    code = Column(String, unique=True, nullable=False)
    status = Column(String, default="ISSUED", nullable=False)
    created_at = Column(DateTime, default=now, nullable=False)

    user = relationship("User", back_populates="coupons")
    festival = relationship("Festival", back_populates="coupons")


class BinScan(Base):
    __tablename__ = "bin_scans"

    id = Column(String, primary_key=True, default=generate_id)
    festival_id = Column(String, ForeignKey("festivals.id"), nullable=False)
    bin_id = Column(String, ForeignKey("trash_bins.id"), nullable=False)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=now, nullable=False)

    festival = relationship("Festival", back_populates="bin_scans")
    bin = relationship("TrashBin", back_populates="scans")
    user = relationship("User", back_populates="bin_scans")


class JackpotPool(Base):
    __tablename__ = "jackpot_pools"

    id = Column(String, primary_key=True, default=generate_id)
    festival_id = Column(String, ForeignKey("festivals.id"), unique=True)
    current_amount = Column(Integer, default=10000)
    seed_amount = Column(Integer, default=10000)
    contribution_rate = Column(Float, default=0.01)
    last_winner_id = Column(String)
    last_draw_date = Column(String)
    updated_at = Column(DateTime, default=now)


class JackpotEntry(Base):
    __tablename__ = "jackpot_entries"

    id = Column(String, primary_key=True, default=generate_id)
    user_id = Column(String, ForeignKey("users.id"))
    festival_id = Column(String, ForeignKey("festivals.id"))
    week_key = Column(String)
    entry_count = Column(Integer, default=1)
    created_at = Column(DateTime, default=now)

    __table_args__ = (UniqueConstraint("user_id", "festival_id", "week_key"),)


class JackpotWinner(Base):
    __tablename__ = "jackpot_winners"

    id = Column(String, primary_key=True, default=generate_id)
    user_id = Column(String, ForeignKey("users.id"))
    festival_id = Column(String, ForeignKey("festivals.id"))
    week_key = Column(String)
    amount = Column(Integer)
    created_at = Column(DateTime, default=now)
