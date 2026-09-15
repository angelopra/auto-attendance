"""
Shrinks oversized uploads before they are stored and run through face detection.

Phone photos routinely weigh several megabytes, far more than recognition needs.
The approach mirrors what messaging apps do: cap the resolution, re-encode as an
optimised progressive JPEG, and step the quality down — then the resolution —
only as far as needed to reach the size target. Resolution is kept as long as
possible because small faces in a group photo need the pixels to be recognised.
"""
import io
from pathlib import Path

from PIL import Image, ImageOps

#: Files at or below this size are stored untouched.
MAX_UPLOAD_BYTES = 500 * 1024
#: Longest side a stored photo may have. Plenty for faces in a group photo.
MAX_DIMENSION = 2560
#: Never shrink below this longest side, even if the size target is missed.
MIN_DIMENSION = 1280
#: JPEG qualities tried in order at each resolution.
QUALITIES = (90, 85, 80, 75)
#: How much the longest side shrinks per step once quality alone is not enough.
SCALE_STEP = 0.85


def _encode_jpeg(img: Image.Image, quality: int) -> bytes:
    buffer = io.BytesIO()
    img.save(
        buffer,
        format="JPEG",
        quality=quality,
        optimize=True,
        progressive=True,
        subsampling="4:2:0",
    )
    return buffer.getvalue()


def _fit(img: Image.Image, longest_side: int) -> Image.Image:
    if max(img.size) <= longest_side:
        return img
    ratio = longest_side / max(img.size)
    size = (max(1, round(img.width * ratio)), max(1, round(img.height * ratio)))
    return img.resize(size, Image.Resampling.LANCZOS)


def compress_image_bytes(data: bytes, target_bytes: int = MAX_UPLOAD_BYTES) -> bytes:
    """Return a JPEG no larger than target_bytes where possible, losing as little as possible."""
    with Image.open(io.BytesIO(data)) as source:
        # Bake the EXIF rotation into the pixels: the metadata is dropped on re-encode.
        img = ImageOps.exif_transpose(source)
        img = img.convert("RGB")

    longest = min(max(img.size), MAX_DIMENSION)
    smallest = None
    while True:
        resized = _fit(img, longest)
        for quality in QUALITIES:
            encoded = _encode_jpeg(resized, quality)
            if smallest is None or len(encoded) < len(smallest):
                smallest = encoded
            if len(encoded) <= target_bytes:
                return encoded
        if longest <= MIN_DIMENSION:
            return smallest
        longest = max(MIN_DIMENSION, int(longest * SCALE_STEP))


def compress_if_large(path: Path) -> Path:
    """
    Replace an oversized image on disk by its compressed JPEG version.

    Returns the path of the file to use from now on (the extension may change).
    Anything Pillow cannot read is left as it was.
    """
    size = path.stat().st_size
    if size <= MAX_UPLOAD_BYTES:
        return path

    try:
        compressed = compress_image_bytes(path.read_bytes())
    except Exception as exc:
        print(f"[image compression] kept original {path}: {exc}")
        return path

    if len(compressed) >= size:
        return path

    dest = path.with_suffix(".jpg")
    dest.write_bytes(compressed)
    if dest != path:
        path.unlink(missing_ok=True)
    print(f"[image compression] {path.name}: {size // 1024} KB -> {len(compressed) // 1024} KB")
    return dest
