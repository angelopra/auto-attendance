"""
Face detection and embedding utilities using InsightFace (RetinaFace detector +
ArcFace embeddings, all via ONNX – no TensorFlow required).
"""
import os
import uuid
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
import insightface
from insightface.app import FaceAnalysis

FACES_DIR = Path("database/uploads/faces")
FACES_DIR.mkdir(parents=True, exist_ok=True)

# Cosine-similarity threshold: detections above this are considered a match.
SIMILARITY_THRESHOLD = float(os.getenv("SIMILARITY_THRESHOLD", "0.40"))

# Initialise the InsightFace pipeline once at import time (buffalo_l = RetinaFace + ArcFace).
_face_app: Optional[FaceAnalysis] = None


def _get_app() -> FaceAnalysis:
    global _face_app
    if _face_app is None:
        _face_app = FaceAnalysis(
            name="buffalo_l",           # RetinaFace detector + ArcFace embedder
            providers=["CPUExecutionProvider"],
        )
        _face_app.prepare(ctx_id=-1, det_size=(640, 640))
    return _face_app


def detect_and_crop_faces(image_path: str) -> list[dict]:
    """
    Detect faces in an image using RetinaFace (via InsightFace).
    Returns a list of dicts with keys: crop_path, embedding, region, score.
    """
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError(f"Cannot read image: {image_path}")

    app = _get_app()
    faces = app.get(img)  # list of Face objects

    results = []
    for face in faces:
        box = face.bbox.astype(int)          # [x1, y1, x2, y2]
        x1, y1, x2, y2 = box
        margin = 10
        h, w = img.shape[:2]
        x1 = max(0, x1 - margin)
        y1 = max(0, y1 - margin)
        x2 = min(w, x2 + margin)
        y2 = min(h, y2 + margin)

        crop = img[y1:y2, x1:x2]
        crop_filename = f"{uuid.uuid4().hex}.jpg"
        crop_path = str(FACES_DIR / crop_filename)
        cv2.imwrite(crop_path, crop)

        embedding = face.normed_embedding.tolist() if face.normed_embedding is not None else None

        results.append(
            {
                "crop_path": crop_path,
                "region": [x1, y1, x2, y2],
                "score": float(face.det_score) if face.det_score is not None else 1.0,
                "embedding": embedding,       # ArcFace embedding already computed
            }
        )

    return results


def compute_embedding(image_path: str) -> Optional[list[float]]:
    """
    Compute an ArcFace embedding for an already-cropped face image.
    Used when adding a selfie to the known-persons database.
    """
    img = cv2.imread(image_path)
    if img is None:
        return None

    app = _get_app()
    faces = app.get(img)
    if not faces:
        return None
    # Pick the largest face in case the selfie has background faces
    largest = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
    if largest.normed_embedding is None:
        return None
    return largest.normed_embedding.tolist()


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Return cosine similarity in [0, 1]; higher = more similar."""
    va = np.array(a, dtype=np.float32)
    vb = np.array(b, dtype=np.float32)
    denom = np.linalg.norm(va) * np.linalg.norm(vb)
    if denom == 0:
        return 0.0
    return float(np.dot(va, vb) / denom)


def find_best_match(
    query_embedding: list[float],
    known_persons: list,          # list of KnownPerson ORM objects
) -> tuple[Optional[object], float]:
    """
    Compare query_embedding against all known persons.
    Returns (best_person_or_None, similarity_score).
    """
    import json

    best_person = None
    best_score = -1.0

    for person in known_persons:
        if not person.embedding:
            continue
        try:
            stored_emb = json.loads(person.embedding)
        except Exception:
            continue
        score = cosine_similarity(query_embedding, stored_emb)
        if score > best_score:
            best_score = score
            best_person = person

    if best_score >= (1.0 - SIMILARITY_THRESHOLD):
        return best_person, best_score
    return None, best_score
