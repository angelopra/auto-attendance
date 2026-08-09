# Attendance App

Automatic attendance tracking from group photos.

## Overview

Upload a group photo for a specific day. The app extracts faces and keeps a person registry across uploads.

New faces start as `Unknown` and must be labeled. When the app fails to recognize a previously known person, you can:

- assign the existing label to the unrecognized face, or
- merge the unrecognized face with an existing recognized profile

The app stores attendance records per person and per day.

## Tabs

| Tab | What it does |
| --- | --- |
| Upload Photo | Upload a group photo for a date, preview it full size, and see the faces it found |
| Known Faces | The registry of labelled people (rename inline: Enter saves, Esc cancels) |
| Attendance | The person × date grid, with an edit mode (see below) |
| Dashboards | Turnout over time, per weekday and per month, rankings, streaks and people who stopped coming |
| Manage | Fix or delete uploaded sessions, download a backup, read the change history |

## Editing Attendance

Attendance is not read-only. Two places let you correct it:

- **Attendance → Edit attendance.** Every registered person stays on screen, including
  on days they missed. Tap a cell to register a presence, tap it again to remove it.
  "Show another date" adds a column for a day that has no photo yet.
- **Manage → Sessions.** *Change date* moves a photo — and every presence it produced —
  to another day, which is how you undo an upload filed under the wrong date.
  *Delete* removes the photo and everything it registered. *Faces* lists the detected
  faces so a single misidentification can be dropped on its own.

Any cell touched by hand — a presence added *or* removed — carries a small pen mark
(✎) in the corner; hovering it says what was changed and when. The same mark appears
beside a name in the dashboard ranking, and the Excel export writes `(manual)` next to
hand-added presences. Removals leave no row behind, so the grid reads them back out of
the audit trail (`GET /attendance/edits`). **Manage → Change history** lists every
by-hand change in full, so manipulated data is always identifiable.

Only labelled people can be given a presence; an unlabelled `Unknown` face has to be
named first.

## Language

The interface ships in **Brazilian Portuguese (default)** and **English**, switched from
the picker in the header and remembered in `localStorage`. Strings live in
`frontend/public/i18n/pt.json` and `en.json` (ngx-translate) — add a language by dropping
another file there and listing it in `LANGUAGES` in
`frontend/src/app/services/language.ts`.

Displayed dates follow the language: `dd/MM/yyyy` in Portuguese, `MM/dd/yyyy` in English.
Date *pickers* are native `<input type="date">` fields, so their format comes from the
browser's own locale, not from this setting — that is browser behaviour a page cannot
override, and it keeps the native calendar on mobile.

## Backups

**Manage → Backup** compresses the whole `database` folder — the SQLite file plus every
uploaded photo, selfie and face crop — and downloads it as one archive.

Two formats:

- **`.tar.gz` (default).** tar stores file names as raw bytes, so accents, `Â`, emoji and
  even names that are not valid UTF-8 round-trip untouched. Use this one if the contents
  might have unusual names.
- **`.zip`.** Easier to open on Windows. Names are written with the UTF-8 flag; anything
  UTF-8 cannot represent is listed in `backup-manifest.json` inside the archive rather
  than being written corrupted.

The SQLite file is snapshotted through sqlite3's online backup API instead of being copied
off disk, so an archive can never contain a half-written database.

To restore, stop the app and unpack the archive over the project root — the archive keeps
the `database/...` paths.

## Running the App

### Docker (recommended)

Use Docker Compose to run both services together:

1. Build and start the containers:
   ```powershell
   docker compose up --build
   ```
2. Open the frontend at `http://localhost:4200`.
3. The backend API is available at `http://localhost:8000`.

The backend stores the SQLite database and uploaded files under `backend/database`, and that folder is mounted from your machine into the backend container.

### Windows PowerShell

Run the `start.ps1` script with PowerShell.

If PowerShell blocks script execution, see the troubleshooting instructions inside the script.

## Resetting Data

To reset all stored data, delete the `backend/database` folder.
