"""
Pydantic schemas for request/response validation.
"""
from __future__ import annotations
import datetime
from typing import Literal, Optional
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
    date_edited_at: Optional[datetime.datetime] = None

    model_config = {"from_attributes": True}


class GroupPhotoUpdate(BaseModel):
    date: datetime.date


# ── Attendance ─────────────────────────────────────────────────────────────────

class AttendanceDetectionOut(BaseModel):
    id: int
    photo_id: int
    person_id: Optional[int] = None
    face_crop_path: Optional[str] = None
    confidence: Optional[str] = None
    person: Optional[KnownPersonOut] = None

    model_config = {"from_attributes": True}


AttendanceSource = Literal["auto", "manual"]


class AttendanceEntry(BaseModel):
    """One presence of a person on a date, and where it came from."""
    date: datetime.date
    source: AttendanceSource
    manual_id: Optional[int] = None   # set when source == "manual"
    note: Optional[str] = None


class AttendanceRow(BaseModel):
    """One row in the attendance report: a person and the dates they appeared."""
    person: KnownPersonOut
    dates: list[datetime.date]
    entries: list[AttendanceEntry] = []


class ManualAttendanceCreate(BaseModel):
    person_id: int
    date: datetime.date
    note: Optional[str] = None


class ManualAttendanceOut(BaseModel):
    id: int
    person_id: int
    date: datetime.date
    note: Optional[str] = None
    created_at: datetime.datetime
    person: Optional[KnownPersonOut] = None

    model_config = {"from_attributes": True}


class PresenceRef(BaseModel):
    """Identifies a presence as the attendance grid shows it: person + date."""
    person_id: int
    date: datetime.date


class PresenceRemovalResult(BaseModel):
    removed_detections: int
    removed_manual: int


class AttendanceEdit(BaseModel):
    """Marks one person/date cell of the attendance grid as touched by hand."""
    person_id: Optional[int] = None
    person_name: str
    date: datetime.date
    change: Literal["added", "removed"]
    changed_at: datetime.datetime


class SessionDayOut(BaseModel):
    """Everything recorded for one attendance date."""
    date: datetime.date
    photos: list[GroupPhotoOut]
    detections: list[AttendanceDetectionOut]
    manual: list[ManualAttendanceOut]


# ── Audit ──────────────────────────────────────────────────────────────────────

class AuditLogOut(BaseModel):
    id: int
    action: str
    person_id: Optional[int] = None
    person_name: Optional[str] = None
    date: Optional[datetime.date] = None
    details: Optional[str] = None
    created_at: datetime.datetime

    model_config = {"from_attributes": True}


# ── Merge ──────────────────────────────────────────────────────────────────────

class MergeRequest(BaseModel):
    source_ids: list[int]   # these will be merged INTO target_id
    target_id: int
