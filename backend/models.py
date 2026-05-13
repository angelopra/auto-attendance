import datetime
from sqlalchemy import Column, Integer, String, Date, ForeignKey, LargeBinary, DateTime, Text
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


class GroupPhoto(Base):
    """A group photo uploaded for a specific date."""
    __tablename__ = "group_photos"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, nullable=False)
    photo_path = Column(String, nullable=False)
    date = Column(Date, nullable=False)
    uploaded_at = Column(DateTime, default=datetime.datetime.utcnow)

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
