# Attendance App

Automatic attendance tracking from group photos.

## Overview

Upload a group photo for a specific day. The app extracts faces and keeps a person registry across uploads.

New faces start as `Unknown` and must be labeled. When the app fails to recognize a previously known person, you can:

- assign the existing label to the unrecognized face, or
- merge the unrecognized face with an existing recognized profile

The app stores attendance records per person and per day.

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
