@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Actualizar POS base desde GitHub

set "POS_DIR=%~dp0"
set "POS_DIR=%POS_DIR:~0,-1%"

if /i "%~1"=="--check" goto :check

if not exist "%POS_DIR%\.git" (
  echo ERROR: Esta carpeta no es un repositorio Git: %POS_DIR%
  pause
  exit /b 1
)

where git.exe >nul 2>nul || (
  echo ERROR: Git no esta instalado o no esta en PATH.
  pause
  exit /b 1
)

pushd "%POS_DIR%"
echo Revisando cambios locales del POS base...
git status --short
for /f "delims=" %%B in ('git branch --show-current') do set "CURRENT_BRANCH=%%B"
if /i not "%CURRENT_BRANCH%"=="prueba-ruta" (
  echo ERROR: La rama actual es "%CURRENT_BRANCH%". Se esperaba prueba-ruta.
  echo Cambia a la rama correcta antes de actualizar.
  popd
  pause
  exit /b 1
)

for /f "delims=" %%S in ('git status --porcelain') do set "LOCAL_STATUS=%%S"
if defined LOCAL_STATUS (
  echo ERROR: Hay cambios locales sin guardar. No se sobrescribiran.
  echo Guarda o respalda esos cambios antes de hacer pull.
  popd
  pause
  exit /b 1
)

git pull --ff-only origin prueba-ruta
if errorlevel 1 (
  echo ERROR: No se pudo actualizar el POS base.
  popd
  pause
  exit /b 1
)

echo.
echo POS base actualizado correctamente.
echo Ahora puedes ejecutar ACTUALIZAR-CLONES.bat para propagar el codigo.
popd
pause
exit /b 0

:check
if not exist "%POS_DIR%\.git" exit /b 1
where git.exe >nul 2>nul || exit /b 1
echo OK: repositorio POS base y Git disponibles.
exit /b 0
