@echo off
rem Double-click to start HyperMapping (see start-hypermapping.ps1 for options).
title HyperMapping
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-hypermapping.ps1" %*
if errorlevel 1 (
  echo.
  echo HyperMapping did not start. Read the message above, then press any key to close.
  pause >nul
)
