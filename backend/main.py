"""
FastAPI application – Kendo Attendance System
"""
import json
import os
import shutil
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Depends, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

import models
import schemas
from database import Base, engine, get_db
from face_utils import (
    compute_embedding,
    detect_and_crop_faces,
    find_best_match,
)

# ── Bootstrap ─────────────────────────────────────────────────────────────────
Base.metadata.create_all(bind=engine)

UPLOAD_DIR = Path("database/uploads")
PHOTOS_DIR = UPLOAD_DIR / "photos"
SELFIES_DIR = UPLOAD_DIR / "selfies"
FACES_DIR = UPLOAD_DIR / "faces"
for d in [PHOTOS_DIR, SELFIES_DIR, FACES_DIR]:
    d.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Kendo Attendance API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory="database/uploads"), name="uploads")


# ── Helper ────────────────────────────────────────────────────────────────────

def save_upload(file: UploadFile, dest_dir: Path) -> tuple[str, str]:
    """Save uploaded file; return (saved_path, original_filename)."""
    ext = Path(file.filename).suffix or ".jpg"
    filename = f"{uuid.uuid4().hex}{ext}"
    dest = dest_dir / filename
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    return str(dest), file.filename


# ── Known Persons ─────────────────────────────────────────────────────────────

@app.get("/persons", response_model=list[schemas.KnownPersonOut])
def list_persons(db: Session = Depends(get_db)):
    return db.query(models.KnownPerson).all()


@app.post("/persons", response_model=schemas.KnownPersonOut)
async def create_person(
    name: str = Form(...),
    selfie: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    selfie_path, _ = save_upload(selfie, SELFIES_DIR)

    embedding = compute_embedding(selfie_path)

    person = models.KnownPerson(
        name=name,
        selfie_path=selfie_path,
        embedding=json.dumps(embedding) if embedding else None,
    )
    db.add(person)
    db.commit()
    db.refresh(person)
    return person


@app.patch("/persons/{person_id}", response_model=schemas.KnownPersonOut)
def update_person(
    person_id: int,
    payload: schemas.KnownPersonUpdate,
    db: Session = Depends(get_db),
):
    person = db.get(models.KnownPerson, person_id)
    if not person:
        raise HTTPException(404, "Person not found")
    if payload.name is not None:
        person.name = payload.name
    db.commit()
    db.refresh(person)
    return person


@app.post("/persons/merge", response_model=schemas.KnownPersonOut)
def merge_persons(payload: schemas.MergeRequest, db: Session = Depends(get_db)):
    """Merge source persons into target person. Detections are re-linked."""
    target = db.get(models.KnownPerson, payload.target_id)
    if not target:
        raise HTTPException(404, "Target person not found")

    for src_id in payload.source_ids:
        if src_id == payload.target_id:
            continue
        source = db.get(models.KnownPerson, src_id)
        if not source:
            continue
        db.query(models.AttendanceDetection).filter(
            models.AttendanceDetection.person_id == src_id
        ).update({"person_id": payload.target_id}, synchronize_session="fetch")
        db.flush()
        db.delete(source)

    db.commit()
    db.refresh(target)
    return target


@app.delete("/persons/{person_id}", status_code=204)
def delete_person(person_id: int, db: Session = Depends(get_db)):
    person = db.get(models.KnownPerson, person_id)
    if not person:
        raise HTTPException(404, "Person not found")
    db.delete(person)
    db.commit()


# ── Group Photos ──────────────────────────────────────────────────────────────

@app.get("/photos", response_model=list[schemas.GroupPhotoOut])
def list_photos(db: Session = Depends(get_db)):
    return db.query(models.GroupPhoto).order_by(models.GroupPhoto.date.desc()).all()


@app.post("/photos/upload", response_model=schemas.GroupPhotoOut)
async def upload_group_photo(
    date: str = Form(...),          # ISO date string YYYY-MM-DD
    photo: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    import datetime as dt

    try:
        photo_date = dt.date.fromisoformat(date)
    except ValueError:
        raise HTTPException(400, "Invalid date format. Use YYYY-MM-DD")

    photo_path, original_filename = save_upload(photo, PHOTOS_DIR)

    group_photo = models.GroupPhoto(
        filename=original_filename,
        photo_path=photo_path,
        date=photo_date,
    )
    db.add(group_photo)
    db.commit()
    db.refresh(group_photo)

    # Run face detection + matching in the background (synchronous here for simplicity)
    _process_group_photo(group_photo.id, photo_path, db)

    return group_photo


def _process_group_photo(photo_id: int, photo_path: str, db: Session):
    """Detect faces in the group photo, match to known persons, persist detections."""
    known_persons = db.query(models.KnownPerson).all()

    try:
        detected_faces = detect_and_crop_faces(photo_path)
    except Exception as exc:
        print(f"[face detection error] {exc}")
        return

    for face in detected_faces:
        crop_path = face["crop_path"]
        # InsightFace computes the embedding during detection – reuse it
        embedding = face.get("embedding") or compute_embedding(crop_path)

        if embedding and known_persons:
            matched_person, score = find_best_match(embedding, known_persons)
        else:
            matched_person, score = None, 0.0

        if matched_person is None and embedding is not None:
            # Create an Unknown placeholder; use the face crop as the selfie
            unknown = models.KnownPerson(
                name="Unknown",
                selfie_path=crop_path,
                embedding=json.dumps(embedding),
            )
            db.add(unknown)
            db.commit()
            db.refresh(unknown)
            matched_person = unknown

        detection = models.AttendanceDetection(
            photo_id=photo_id,
            person_id=matched_person.id if matched_person else None,
            face_crop_path=crop_path,
            confidence=f"{score:.4f}" if score else None,
        )
        db.add(detection)

    db.commit()


# ── Attendance Report ──────────────────────────────────────────────────────────

@app.get("/attendance", response_model=list[schemas.AttendanceRow])
def get_attendance(db: Session = Depends(get_db)):
    """Return each known person and the dates they were detected."""
    persons = db.query(models.KnownPerson).all()
    rows: list[schemas.AttendanceRow] = []
    for person in persons:
        dates = sorted(
            set(
                det.photo.date
                for det in person.detections
                if det.photo is not None
            )
        )
        rows.append(schemas.AttendanceRow(person=person, dates=dates))
    return rows


@app.get("/attendance/detections/{photo_id}", response_model=list[schemas.AttendanceDetectionOut])
def get_detections_for_photo(photo_id: int, db: Session = Depends(get_db)):
    return (
        db.query(models.AttendanceDetection)
        .filter(models.AttendanceDetection.photo_id == photo_id)
        .all()
    )
