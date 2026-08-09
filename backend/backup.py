"""
Backup of the whole `database/` folder (SQLite file + uploaded images).

Two archive formats are offered:

* ``tar.gz`` -- the default. tar stores file names as raw bytes, so it round-trips
  anything the filesystem accepts: accents, "Â", emoji, even names that are not
  valid UTF-8. This is the format to use when in doubt.
* ``zip`` -- more convenient to open on Windows. Names are written with the UTF-8
  flag set; a name that cannot be represented in UTF-8 at all is skipped rather
  than silently corrupted (and reported in the manifest).

The SQLite file is never copied straight off disk -- it is snapshotted through
sqlite3's online backup API, so the archive can never contain a half-written
database, even if a request is being handled while the backup runs.
"""
from __future__ import annotations

import datetime
import io
import json
import sqlite3
import tarfile
import tempfile
import zipfile
from pathlib import Path

DATABASE_DIR = Path("database")
DB_FILENAME = "kendo.db"

FORMATS = {
    "tar.gz": ".tar.gz",
    "zip": ".zip",
}


def _snapshot_sqlite(db_path: Path, dest: Path) -> bool:
    """Copy the live SQLite database into `dest` using the online backup API."""
    if not db_path.exists():
        return False
    source = sqlite3.connect(str(db_path))
    try:
        target = sqlite3.connect(str(dest))
        try:
            with target:
                source.backup(target)
        finally:
            target.close()
    finally:
        source.close()
    return True


def _collect_files(root: Path) -> list[Path]:
    """All regular files under `root`, sorted, excluding SQLite side-car files."""
    skipped_suffixes = ("-wal", "-shm", "-journal")
    files: list[Path] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        if path.name.startswith(DB_FILENAME) and path.name.endswith(skipped_suffixes):
            continue
        files.append(path)
    return files


def _is_utf8_safe(name: str) -> bool:
    try:
        name.encode("utf-8")
        return True
    except UnicodeEncodeError:
        # Names that arrived through surrogateescape are not representable in a zip.
        return False


def create_backup_archive(fmt: str = "tar.gz") -> tuple[Path, str]:
    """
    Build the archive in a temp directory.

    Returns ``(archive_path, download_filename)``. The caller owns the temp
    directory and must delete it (see the BackgroundTask in main.py).
    """
    if fmt not in FORMATS:
        raise ValueError(f"Unsupported format: {fmt}")

    workdir = Path(tempfile.mkdtemp(prefix="attendance-backup-"))
    stamp = datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S")
    download_name = f"attendance-backup_{stamp}{FORMATS[fmt]}"
    archive_path = workdir / download_name

    root = DATABASE_DIR
    files = _collect_files(root) if root.exists() else []

    # Consistent snapshot of the database file, used in place of the on-disk copy.
    snapshot = workdir / DB_FILENAME
    db_path = root / DB_FILENAME
    has_snapshot = _snapshot_sqlite(db_path, snapshot)

    skipped: list[str] = []
    manifest = {
        "created_at": datetime.datetime.now().astimezone().isoformat(),
        "source": str(root),
        "format": fmt,
        "database_snapshot": has_snapshot,
        "file_count": len(files),
    }

    def source_for(path: Path) -> Path:
        return snapshot if (has_snapshot and path == db_path) else path

    if fmt == "tar.gz":
        with tarfile.open(archive_path, "w:gz") as tar:
            for path in files:
                tar.add(source_for(path), arcname=str(path.as_posix()))
            manifest_bytes = json.dumps(manifest, indent=2).encode("utf-8")
            info = tarfile.TarInfo("backup-manifest.json")
            info.size = len(manifest_bytes)
            info.mtime = int(datetime.datetime.now().timestamp())
            tar.addfile(info, io.BytesIO(manifest_bytes))
    else:
        with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for path in files:
                arcname = path.as_posix()
                if not _is_utf8_safe(arcname):
                    skipped.append(repr(arcname))
                    continue
                source = source_for(path)
                info = zipfile.ZipInfo.from_file(source, arcname)
                info.compress_type = zipfile.ZIP_DEFLATED
                info.flag_bits |= 0x800  # names are UTF-8
                zf.writestr(info, source.read_bytes())
            manifest["skipped_unencodable_names"] = skipped
            zf.writestr("backup-manifest.json", json.dumps(manifest, indent=2))

    return archive_path, download_name


def backup_size_estimate() -> dict:
    """Rough size of what a backup would contain, for showing in the UI."""
    root = DATABASE_DIR
    if not root.exists():
        return {"file_count": 0, "total_bytes": 0}
    files = _collect_files(root)
    return {
        "file_count": len(files),
        "total_bytes": sum(f.stat().st_size for f in files),
    }
