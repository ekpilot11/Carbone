@echo off
REM Double-click this to start everything: Docker, the latest code, the app,
REM and the address for your phone. The real work is in scripts\start-lens.ps1,
REM which is plain text and can be read and edited.
REM
REM -ExecutionPolicy Bypass applies to this run only; it changes nothing about
REM the machine, and is what lets a .ps1 next to it run without ceremony.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-lens.ps1"
if errorlevel 1 pause
