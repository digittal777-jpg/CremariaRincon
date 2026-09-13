@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Actualizar clones POS desde cremeria-rincon

set "POS_DIR=%~dp0"
set "POS_DIR=%POS_DIR:~0,-1%"
for %%I in ("%POS_DIR%\..") do set "WORKSPACE_DIR=%%~fI"
set "OWNER_DIR=%WORKSPACE_DIR%\owner-control"

if /i "%~1"=="--check" goto :check

if not exist "%POS_DIR%\package.json" (
  echo ERROR: Ejecuta este archivo desde cremeria-rincon.
  pause
  exit /b 1
)
if not exist "%POS_DIR%\node_modules" (
  echo ERROR: Primero instala las dependencias del POS base.
  pause
  exit /b 1
)

where robocopy.exe >nul 2>nul || (
  echo ERROR: Robocopy no esta disponible en Windows.
  pause
  exit /b 1
)

echo IMPORTANTE: cierra el POS y las ventanas de los clones antes de continuar.
echo Este proceso no modifica bases de datos, usuarios, catalogos ni tokens.
echo.
choice /C SN /N /M "Continuar con la actualizacion de clones? [S/N]: "
if errorlevel 2 exit /b 0

set "UPDATED=0"
set "SKIPPED=0"
for /D %%D in ("%WORKSPACE_DIR%\*") do call :updateCandidate "%%~fD"

echo.
echo Clones actualizados: %UPDATED%
echo Carpetas omitidas: %SKIPPED%
echo.
echo Las dependencias se comparten desde el POS base mediante junction.
pause
exit /b 0

:check
if not exist "%POS_DIR%\package.json" exit /b 1
if not exist "%POS_DIR%\node_modules" exit /b 1
where robocopy.exe >nul 2>nul || exit /b 1
echo OK: POS base, dependencias y Robocopy disponibles.
exit /b 0

:updateCandidate
set "CLONE_DIR=%~1"
if /i "%CLONE_DIR%"=="%POS_DIR%" exit /b 0
if /i "%CLONE_DIR%"=="%OWNER_DIR%" exit /b 0
if not exist "%CLONE_DIR%\package.json" exit /b 0
if not exist "%CLONE_DIR%\src\server.js" exit /b 0

echo.
echo Actualizando: %CLONE_DIR%
robocopy "%POS_DIR%" "%CLONE_DIR%" /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /XD ".git" "node_modules" "data" "coverage" ".tmp-demo" ".tmp-compat" ".tmp-railway" ".tmp-provisioning" "docs" "obsidian-merxalia-pos" /XF "*.sqlite" "*.sqlite-wal" "*.sqlite-shm" "*.xlsx" "*.log" ".pos-runtime.json" ".pos-runtime.env" "pos-runtime-config.json" >nul
set "ROBOCODE=%ERRORLEVEL%"
if %ROBOCODE% GEQ 8 (
  echo ERROR: No se pudo actualizar %CLONE_DIR% (Robocopy %ROBOCODE%).
  set /a SKIPPED+=1
  exit /b 0
)

if exist "%CLONE_DIR%\node_modules" (
  fsutil reparsepoint query "%CLONE_DIR%\node_modules" >nul 2>nul
  if errorlevel 1 (
    echo Aviso: node_modules no es junction; no se reemplaza automaticamente.
  )
) else (
  mklink /J "%CLONE_DIR%\node_modules" "%POS_DIR%\node_modules" >nul 2>nul
  if errorlevel 1 echo Aviso: no se pudo crear junction de node_modules.
)
set /a UPDATED+=1
exit /b 0
