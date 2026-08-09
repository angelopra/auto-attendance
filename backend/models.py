import datetime
from sqlalchemy import Column, Integer, String, Date, ForeignKey, LargeBinary, DateTime, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from database import Base


class KnownPerson(Base):
    """A person entry in the 'database' of known faces."""
    __tablename__ = "known_persons"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, default="Unknown")
    selfie_path = Column(String, nullable=True)       # path to stored selfie image
    embedding = Column(Text, nullable=True)           # JSON-serialised face embedding vector
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    detections = relationship("AttendanceDetection", back_populates="person")
    manual_attendances = relationship(
        "ManualAttendance",
        back_populates="person",
        cascade="all, delete-orphan",
    )


class GroupPhoto(Base):
    """A group photo uploaded for a specific date."""
    __tablename__ = "group_photos"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, nullable=False)
    photo_path = Column(String, nullable=False)
    date = Column(Date, nullable=False)
    uploaded_at = Column(DateTime, default=datetime.datetime.utcnow)
    # Set when the date was corrected by hand, so edited sessions can be flagged.
    date_edited_at = Column(DateTime, nullable=True)

    detections = relationship("AttendanceDetection", back_populates="photo")


class AttendanceDetection(Base):
    """A detected face in a group photo, linked to a known person."""
    __tablename__ = "attendance_detections"

    id = Column(Integer, primary_key=True, index=True)
    photo_id = Column(Integer, ForeignKey("group_photos.id"), nullable=False)
    person_id = Column(Integer, ForeignKey("known_persons.id"), nullable=True)
    face_crop_path = Column(String, nullable=True)    # path to the cropped face
    confidence = Column(String, nullable=True)        # similarity score
    detected_at = Column(DateTime, default=datetime.datetime.utcnow)

    photo = relationship("GroupPhoto", back_populates="detections")
    person = relationship("KnownPerson", back_populates="detections")


class ManualAttendance(Base):
    """A presence registered by hand, without a face in a group photo."""
    __tablename__ = "manual_attendances"
    __table_args__ = (UniqueConstraint("person_id", "date", name="uq_manual_person_date"),)

    id = Column(Integer, primary_key=True, index=True)
    person_id = Column(Integer, ForeignKey("known_persons.id"), nullable=False)
    date = Column(Date, nullable=False, index=True)
    note = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    person = relationship("KnownPerson", back_populates="manual_attendances")


class AuditLog(Base):
    """Trail of every by-hand change, so manipulated data stays identifiable."""
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, index=True)
    action = Column(String, nullable=False)            # e.g. presence_added, photo_deleted
    person_id = Column(Integer, nullable=True)         # not a FK: survives person deletion
    person_name = Column(String, nullable=True)
    date = Column(Date, nullable=True)                 # attendance date the change refers to
    details = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
