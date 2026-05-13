# Kendo Attendance – start both servers

#Instructions:
# Have Python and Angular installed
# Right click, "Execute with PowerShell, or
# Open powershell as admin in the root of this project and run this script with "./start.ps1".
# If unallowed, run "Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process".
# If this file was downloaded from elsewhere, go to its properties and unlock it under the "general" tab.
# If you have changed the origin of the project, you have to delete the "/backend/venv" folder.
# The backend is slow to start, so be patient.

# Backend
Start-Process powershell -ArgumentList "-NoExit", "-Command", @"
  cd '$PSScriptRoot\backend'
  if (-not (Test-Path 'venv')) { python -m venv venv }
  .\venv\Scripts\Activate.ps1
  pip install -r requirements.txt --quiet
  uvicorn main:app --reload --host 0.0.0.0 --port 8000
"@

# Frontend
Start-Process powershell -ArgumentList "-NoExit", "-Command", @"
  cd '$PSScriptRoot\frontend'
  npx ng serve --open
"@

Write-Host "Started backend on http://localhost:8000  and frontend on http://localhost:4200"
