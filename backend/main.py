"""
FastAPI application -- Kendo Attendance System
"""
import datetime as dt
import json
import os
import shutil
import uuid
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask

import backup as backup_utils
import models
import schemas
from database import Base, apply_pending_migrations, engine, get_db
from face_utils import (
    compute_embedding,
    detect_and_crop_faces,
    find_best_match,
)

# ── Bootstrap ─────────────────────────────────────────────────────────────────
_startup_error = None

UPLOAD_DIR = Path("database/uploads")
PHOTOS_DIR = UPLOAD_DIR / "photos"
SELFIES_DIR = UPLOAD_DIR / "selfies"
FACES_DIR = UPLOAD_DIR / "faces"

UNKNOWN_NAME = "Unknown"

try:
    Base.metadata.create_all(bind=engine)
    apply_pending_migrations()

    for d in [PHOTOS_DIR, SELFIES_DIR, FACES_DIR]:
        d.mkdir(parents=True, exist_ok=True)

    print("Ready — listening on http://0.0.0.0:8223")
except Exception as e:
    _startup_error = str(e)
    print(f"Startup error: {_startup_error}")

app = FastAPI(title="Kendo Attendance API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def verify_auth(request: Request, call_next):
    if _startup_error:
        return JSONResponse(status_code=503, content={"error": f"Service unavailable: {_startup_error}"})
    auth_token = os.environ.get("AUTH_TOKEN")
    if not auth_token:
        return JSONResponse(status_code=500, content={"error": "AUTH_TOKEN is not set"})
    path = request.url.path
    if path.startswith("/uploads") or path.startswith("/static"):
        return await call_next(request)
    if "." in path.split("/")[-1]:
        return await call_next(request)
    if request.query_params.get("auth") != auth_token:
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    return await call_next(request)


app.mount("/uploads", StaticFiles(directory="database/uploads"), name="uploads")


# ── Helpers ───────────────────────────────────────────────────────────────────

def save_upload(file: UploadFile, dest_dir: Path) -> tuple[str, str]:
    """Save uploaded file; return (saved_path, original_filename)."""
    ext = Path(file.filename).suffix or ".jpg"
    filename = f"{uuid.uuid4().hex}{ext}"
    dest = dest_dir / filename
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    return str(dest), file.filename


def log_change(
    db: Session,
    action: str,
    *,
    person: Optional[models.KnownPerson] = None,
    date: Optional[dt.date] = None,
    details: Optional[str] = None,
) -> None:
    """Record a by-hand change so manipulated data stays traceable."""
    db.add(
        models.AuditLog(
            action=action,
            person_id=person.id if person else None,
            person_name=person.name if person else None,
            date=date,
            details=details,
        )
    )


def name_group_ids(db: Session, person: models.KnownPerson) -> list[int]:
    """
    Ids of every person row that shares this name.

    Labelling faces renames rows rather than merging them, so one name can map to
    several rows. The attendance grid shows one line per name, so edits made from
    that grid have to cover the whole name group. Unknown faces are the exception:
    they all share the placeholder name but are different people.
    """
    if person.name == UNKNOWN_NAME:
        return [person.id]
    return [
        pid
        for (pid,) in db.query(models.KnownPerson.id)
        .filter(models.KnownPerson.name == person.name)
        .all()
    ]


def delete_file_if_unreferenced(db: Session, path: Optional[str]) -> None:
    """Delete an image file unless some person still uses it as their selfie."""
    if not path:
        return
    still_used = (
        db.query(models.KnownPerson.id)
        .filter(models.KnownPerson.selfie_path == path)
        .first()
    )
    if still_used:
        return
    try:
        Path(path).unlink(missing_ok=True)
    except OSError as exc:
        print(f"[file cleanup] could not delete {path}: {exc}")


def prune_orphan_unknowns(db: Session) -> int:
    """Drop Unknown placeholders that no longer have any presence attached."""
    orphans = (
        db.query(models.KnownPerson)
        .filter(models.KnownPerson.name == UNKNOWN_NAME)
        .all()
    )
    removed = 0
    for person in orphans:
        if person.detections or person.manual_attendances:
            continue
        selfie = person.selfie_path
        db.delete(person)
        db.flush()
        delete_file_if_unreferenced(db, selfie)
        removed += 1
    return removed


def presence_exists(db: Session, person_ids: list[int], date: dt.date) -> bool:
    auto = (
        db.query(models.AttendanceDetection.id)
        .join(models.GroupPhoto, models.AttendanceDetection.photo_id == models.GroupPhoto.id)
        .filter(models.AttendanceDetection.person_id.in_(person_ids))
        .filter(models.GroupPhoto.date == date)
        .first()
    )
    if auto:
        return True
    manual = (
        db.query(models.ManualAttendance.id)
        .filter(models.ManualAttendance.person_id.in_(person_ids))
        .filter(models.ManualAttendance.date == date)
        .first()
    )
    return manual is not None


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


# unused (doesn't behave as desired)
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
    presences = len(person.detections) + len(person.manual_attendances)
    log_change(
        db,
        "person_deleted",
        person=person,
        details=f"Person removed along with {presences} presence(s)",
    )
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


@app.patch("/photos/{photo_id}", response_model=schemas.GroupPhotoOut)
def update_group_photo(
    photo_id: int,
    payload: schemas.GroupPhotoUpdate,
    db: Session = Depends(get_db),
):
    """Move a photo (and every presence it produced) to another date."""
    photo = db.get(models.GroupPhoto, photo_id)
    if not photo:
        raise HTTPException(404, "Photo not found")

    old_date = photo.date
    if payload.date == old_date:
        return photo

    photo.date = payload.date
    photo.date_edited_at = dt.datetime.utcnow()
    log_change(
        db,
        "photo_date_changed",
        date=payload.date,
        details=f'Photo "{photo.filename}" (#{photo.id}) moved from {old_date} to {payload.date}',
    )
    db.commit()
    db.refresh(photo)
    return photo


@app.delete("/photos/{photo_id}", status_code=204)
def delete_group_photo(photo_id: int, db: Session = Depends(get_db)):
    """Delete a photo together with every presence it produced."""
    photo = db.get(models.GroupPhoto, photo_id)
    if not photo:
        raise HTTPException(404, "Photo not found")

    detections = list(photo.detections)
    crop_paths = [d.face_crop_path for d in detections]
    for detection in detections:
        db.delete(detection)
    db.flush()

    for crop_path in crop_paths:
        delete_file_if_unreferenced(db, crop_path)

    photo_path = photo.photo_path
    filename = photo.filename
    photo_date = photo.date
    db.delete(photo)
    db.flush()

    pruned = prune_orphan_unknowns(db)

    log_change(
        db,
        "photo_deleted",
        date=photo_date,
        details=(
            f'Photo "{filename}" (#{photo_id}) of {photo_date} deleted; '
            f"{len(detections)} presence(s) removed, {pruned} unknown face(s) pruned"
        ),
    )
    db.commit()

    try:
        Path(photo_path).unlink(missing_ok=True)
    except OSError as exc:
        print(f"[file cleanup] could not delete {photo_path}: {exc}")


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
                name=UNKNOWN_NAME,
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
    """Return each known person and the dates they were present, with the source."""
    persons = db.query(models.KnownPerson).all()
    rows: list[schemas.AttendanceRow] = []

    for person in persons:
        entries: dict[dt.date, schemas.AttendanceEntry] = {}

        for detection in person.detections:
            if detection.photo is None:
                continue
            entries.setdefault(
                detection.photo.date,
                schemas.AttendanceEntry(date=detection.photo.date, source="auto"),
            )

        for manual in person.manual_attendances:
            # A face found in a photo outranks a hand-added entry for the same day.
            if entries.get(manual.date) is not None:
                continue
            entries[manual.date] = schemas.AttendanceEntry(
                date=manual.date,
                source="manual",
                manual_id=manual.id,
                note=manual.note,
            )

        ordered = [entries[d] for d in sorted(entries)]
        rows.append(
            schemas.AttendanceRow(
                person=person,
                dates=[e.date for e in ordered],
                entries=ordered,
            )
        )

    return rows


@app.get("/attendance/detections/{photo_id}", response_model=list[schemas.AttendanceDetectionOut])
def get_detections_for_photo(photo_id: int, db: Session = Depends(get_db)):
    return (
        db.query(models.AttendanceDetection)
        .filter(models.AttendanceDetection.photo_id == photo_id)
        .all()
    )


#: Audit actions that leave a visible mark on one cell of the attendance grid.
CELL_EDIT_ACTIONS = {
    "presence_added": "added",
    "presence_removed": "removed",
    "detection_removed": "removed",
}


@app.get("/attendance/edits", response_model=list[schemas.AttendanceEdit])
def get_attendance_edits(db: Session = Depends(get_db)):
    """
    The latest by-hand change per person/date.

    Removals leave no row behind, so the grid cannot tell an edited empty cell from
    one that was always empty — this reads that back out of the audit trail.
    """
    entries = (
        db.query(models.AuditLog)
        .filter(models.AuditLog.action.in_(CELL_EDIT_ACTIONS.keys()))
        .filter(models.AuditLog.date.isnot(None))
        .order_by(models.AuditLog.created_at.asc(), models.AuditLog.id.asc())
        .all()
    )
    # Follow renames: the grid groups people by their current name.
    current_names = {p.id: p.name for p in db.query(models.KnownPerson).all()}

    latest: dict[tuple[str, dt.date], schemas.AttendanceEdit] = {}
    for entry in entries:
        name = current_names.get(entry.person_id) or entry.person_name
        if not name:
            continue
        latest[(name, entry.date)] = schemas.AttendanceEdit(
            person_id=entry.person_id,
            person_name=name,
            date=entry.date,
            change=CELL_EDIT_ACTIONS[entry.action],
            changed_at=entry.created_at,
        )
    return list(latest.values())


@app.get("/attendance/day/{date}", response_model=schemas.SessionDayOut)
def get_day(date: dt.date, db: Session = Depends(get_db)):
    """Everything recorded for one date: photos, detected faces and manual entries."""
    photos = (
        db.query(models.GroupPhoto)
        .filter(models.GroupPhoto.date == date)
        .order_by(models.GroupPhoto.uploaded_at)
        .all()
    )
    photo_ids = [p.id for p in photos]
    detections = (
        db.query(models.AttendanceDetection)
        .filter(models.AttendanceDetection.photo_id.in_(photo_ids))
        .all()
        if photo_ids
        else []
    )
    manual = (
        db.query(models.ManualAttendance)
        .filter(models.ManualAttendance.date == date)
        .all()
    )
    return schemas.SessionDayOut(
        date=date, photos=photos, detections=detections, manual=manual
    )


@app.post("/attendance/manual", response_model=schemas.ManualAttendanceOut, status_code=201)
def add_manual_attendance(
    payload: schemas.ManualAttendanceCreate,
    db: Session = Depends(get_db),
):
    """Register a presence by hand, for someone who was there but not in the photo."""
    person = db.get(models.KnownPerson, payload.person_id)
    if not person:
        raise HTTPException(404, "Person not found")
    if person.name == UNKNOWN_NAME:
        raise HTTPException(400, "Label this face before registering attendance for it")

    group = name_group_ids(db, person)
    if presence_exists(db, group, payload.date):
        raise HTTPException(409, f"{person.name} is already registered for {payload.date}")

    manual = models.ManualAttendance(
        person_id=person.id, date=payload.date, note=payload.note
    )
    db.add(manual)
    log_change(
        db,
        "presence_added",
        person=person,
        date=payload.date,
        details=payload.note or "Presence added by hand",
    )
    db.commit()
    db.refresh(manual)
    return manual


@app.post("/attendance/presence/remove", response_model=schemas.PresenceRemovalResult)
def remove_presence(payload: schemas.PresenceRef, db: Session = Depends(get_db)):
    """
    Remove one person's presence on one date.

    Covers both sources: detected faces are unlinked from the day and hand-added
    entries are deleted, so the attendance grid cell really does go empty.
    """
    person = db.get(models.KnownPerson, payload.person_id)
    if not person:
        raise HTTPException(404, "Person not found")

    group = name_group_ids(db, person)

    detections = (
        db.query(models.AttendanceDetection)
        .join(models.GroupPhoto, models.AttendanceDetection.photo_id == models.GroupPhoto.id)
        .filter(models.AttendanceDetection.person_id.in_(group))
        .filter(models.GroupPhoto.date == payload.date)
        .all()
    )
    manual_rows = (
        db.query(models.ManualAttendance)
        .filter(models.ManualAttendance.person_id.in_(group))
        .filter(models.ManualAttendance.date == payload.date)
        .all()
    )

    if not detections and not manual_rows:
        raise HTTPException(404, f"{person.name} has no presence on {payload.date}")

    crop_paths = [d.face_crop_path for d in detections]
    for detection in detections:
        db.delete(detection)
    for row in manual_rows:
        db.delete(row)

    db.flush()
    for crop_path in crop_paths:
        delete_file_if_unreferenced(db, crop_path)

    log_change(
        db,
        "presence_removed",
        person=person,
        date=payload.date,
        details=(
            f"{len(detections)} detected face(s) and {len(manual_rows)} manual entry(ies) removed"
        ),
    )
    db.commit()
    return schemas.PresenceRemovalResult(
        removed_detections=len(detections), removed_manual=len(manual_rows)
    )


@app.delete("/attendance/detections/{detection_id}", status_code=204)
def delete_detection(detection_id: int, db: Session = Depends(get_db)):
    """Drop a single detected face (e.g. a misidentification)."""
    detection = db.get(models.AttendanceDetection, detection_id)
    if not detection:
        raise HTTPException(404, "Detection not found")

    person = detection.person
    date = detection.photo.date if detection.photo else None
    crop_path = detection.face_crop_path

    db.delete(detection)
    db.flush()
    delete_file_if_unreferenced(db, crop_path)
    prune_orphan_unknowns(db)

    log_change(
        db,
        "detection_removed",
        person=person,
        date=date,
        details=f"Detected face #{detection_id} removed",
    )
    db.commit()


@app.delete("/attendance/manual/{manual_id}", status_code=204)
def delete_manual_attendance(manual_id: int, db: Session = Depends(get_db)):
    manual = db.get(models.ManualAttendance, manual_id)
    if not manual:
        raise HTTPException(404, "Manual attendance not found")
    person = manual.person
    date = manual.date
    db.delete(manual)
    log_change(
        db,
        "presence_removed",
        person=person,
        date=date,
        details="Manual entry removed",
    )
    db.commit()


# ── Audit trail ────────────────────────────────────────────────────────────────

@app.get("/audit", response_model=list[schemas.AuditLogOut])
def get_audit_log(limit: int = Query(200, ge=1, le=2000), db: Session = Depends(get_db)):
    return (
        db.query(models.AuditLog)
        .order_by(models.AuditLog.created_at.desc(), models.AuditLog.id.desc())
        .limit(limit)
        .all()
    )


# ── Backup ─────────────────────────────────────────────────────────────────────

@app.get("/backup/info")
def backup_info():
    return backup_utils.backup_size_estimate()


@app.get("/backup")
def download_backup(format: str = Query("tar.gz", pattern="^(tar\\.gz|zip)$")):
    """Compress the whole database folder and send it as a download."""
    try:
        archive_path, download_name = backup_utils.create_backup_archive(format)
    except Exception as exc:
        raise HTTPException(500, f"Backup failed: {exc}")

    media_type = "application/gzip" if format == "tar.gz" else "application/zip"
    return FileResponse(
        archive_path,
        media_type=media_type,
        filename=download_name,
        background=BackgroundTask(shutil.rmtree, archive_path.parent, True),
    )


# -- SPA Static File Serving -------------------------------------------------

STATIC_DIR = Path("static")

if STATIC_DIR.exists():

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = STATIC_DIR / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(STATIC_DIR / "index.html")
