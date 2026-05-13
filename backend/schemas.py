"""
Pydantic schemas for request/response validation.
"""
from __future__ import annotations
import datetime
from typing import Optional
from pydantic import BaseModel


# ── Known Persons ──────────────────────────────────────────────────────────────

class KnownPersonBase(BaseModel):
    name: str


class KnownPersonCreate(KnownPersonBase):
    pass


class KnownPersonUpdate(BaseModel):
    name: Optional[str] = None


class KnownPersonOut(KnownPersonBase):
    id: int
    selfie_path: Optional[str] = None
    created_at: datetime.datetime
    updated_at: datetime.datetime

    model_config = {"from_attributes": True}


# ── Group Photos ───────────────────────────────────────────────────────────────

class GroupPhotoOut(BaseModel):
    id: int
    filename: str
    photo_path: str
    date: datetime.date
    uploaded_at: datetime.datetime

    model_config = {"from_attributes": True}


# ── Attendance ─────────────────────────────────────────────────────────────────

class AttendanceDetectionOut(BaseModel):
    id: int
    photo_id: int
    person_id: Optional[int] = None
    face_crop_path: Optional[str] = None
    confidence: Optional[str] = None
    person: Optional[KnownPersonOut] = None

    model_config = {"from_attributes": True}


class AttendanceRow(BaseModel):
    """One row in the attendance report: a person and the dates they appeared."""
    person: KnownPersonOut
    dates: list[datetime.date]


# ── Merge ──────────────────────────────────────────────────────────────────────

class MergeRequest(BaseModel):
    source_ids: list[int]   # these will be merged INTO target_id
    target_id: int
