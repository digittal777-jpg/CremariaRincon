@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Instalador comercial Merxalia POS

set "POS_DIR=%~dp0"
set "POS_DIR=%POS_DIR:~0,-1%"
for %%I in ("%POS_DIR%\..") do set "WORKSPACE_DIR=%%~fI"
set "OWNER_DIR=%WORKSPACE_DIR%\owner-control"

if /i "%~1"=="--check" goto :check

echo.
echo ==============================================
echo    INSTALADOR COMERCIAL MERXALIA POS
echo ==============================================
echo.

if not exist "%POS_DIR%\package.json" (
  echo ERROR: Ejecuta este archivo desde la carpeta cremeria-rincon.
  goto :failed
)
if not exist "%OWNER_DIR%\package.json" (
  echo ERROR: No encuentro owner-control en "%OWNER_DIR%".
  goto :failed
)
where node >nul 2>nul || (
  echo ERROR: Node.js no esta instalado o no esta en PATH.
  echo Instala Node.js 24 o superior y vuelve a ejecutar este archivo.
  goto :failed
)
where npm >nul 2>nul || (
  echo ERROR: npm no esta disponible en PATH.
  goto :failed
)

for /f "delims=" %%V in ('node --version') do set "NODE_VERSION=%%V"
echo Node detectado: %NODE_VERSION%
echo.

echo [1/6] Instalando dependencias de owner-control...
pushd "%OWNER_DIR%"
call npm.cmd install
if errorlevel 1 goto :failed
popd

echo [2/6] Instalando dependencias del POS base...
pushd "%POS_DIR%"
call npm.cmd install
if errorlevel 1 goto :failed
popd

echo.
echo El token owner-control protege tu panel central.
echo Deja vacio para generar uno nuevo automaticamente.
set "OWNER_CONTROL_TOKEN="
set /p "OWNER_CONTROL_TOKEN=OWNER_CONTROL_TOKEN: "
if not defined OWNER_CONTROL_TOKEN for /f "delims=" %%T in ('node -e "const c=require('node:crypto'); console.log('owner_'+c.randomBytes(32).toString('base64url'))"') do set "OWNER_CONTROL_TOKEN=%%T"

set "OWNER_CONTROL_DB_PATH=%OWNER_DIR%\data\owner-control.sqlite"
set "OWNER_CONTROL_PORT=3200"
set "OWNER_CONTROL_REQUIRE_CLIENT_SIGNATURE=true"
set "OWNER_CONTROL_PUBLIC_ORIGIN=http://localhost:3200"
set "OWNER_CONTROL_FORCE_HTTPS=false"
set "OWNER_CONTROL_TRUST_PROXY=false"

echo.
echo [3/6] Iniciando owner-control en otra ventana...
echo Token owner-control de esta sesion:
echo %OWNER_CONTROL_TOKEN%
echo.
set "BUSINESS_NAME="
set /p "BUSINESS_NAME=Nombre del negocio: "
if not defined BUSINESS_NAME set "BUSINESS_NAME=Mi negocio"

set "CLIENT_SLUG="
set /p "CLIENT_SLUG=Slug del cliente, ejemplo abarrotes-lupita: "
if not defined CLIENT_SLUG (
  echo ERROR: El slug es obligatorio.
  goto :failed
)
if /i "%CLIENT_SLUG%"=="cremeria-rincon" (
  echo ERROR: El slug no puede ser cremeria-rincon porque esa es la carpeta del POS base.
  echo Usa otro slug, por ejemplo cremeria-el-rincon o cremeria-lupita.
  goto :failed
)

set "TEMPLATE="
set /p "TEMPLATE=Plantilla [abarrotes/cremeria/dulceria/ferreteria/limpieza/papeleria]: "
if not defined TEMPLATE set "TEMPLATE=abarrotes"
set "CATALOG=%POS_DIR%\catalogos\%TEMPLATE%-base.xlsx"
if not exist "%CATALOG%" (
  echo ERROR: No existe "%CATALOG%".
  goto :failed
)

set "PUBLIC_URL="
set /p "PUBLIC_URL=URL publica del POS [http://localhost:3100]: "
if not defined PUBLIC_URL set "PUBLIC_URL=http://localhost:3100"

start "Merxalia owner-control" /D "%OWNER_DIR%" cmd.exe /d /k "npm.cmd start"
echo Registrando automaticamente el cliente en owner-control...
set "CONTROL_CLIENT_SECRET="
set "OWNER_CLIENT_RESULT=%TEMP%\merxalia-owner-client-%RANDOM%.log"
node "%POS_DIR%\scripts\provision-owner-client.js" --url "http://localhost:3200" --slug "%CLIENT_SLUG%" --name "%BUSINESS_NAME%" --base-url "%PUBLIC_URL%" > "%OWNER_CLIENT_RESULT%" 2>&1
if errorlevel 1 (
  echo.
  echo ERROR detallado al registrar el cliente:
  type "%OWNER_CLIENT_RESULT%"
  del /q "%OWNER_CLIENT_RESULT%" >nul 2>nul
  goto :failed
)
set /p "CONTROL_CLIENT_SECRET=" < "%OWNER_CLIENT_RESULT%"
del /q "%OWNER_CLIENT_RESULT%" >nul 2>nul
if not defined CONTROL_CLIENT_SECRET (
  echo ERROR: owner-control no devolvio una API key.
  goto :failed
)
echo Cliente registrado y API key recibida.

echo.
echo [4/6] Creando clon del cliente...
pushd "%POS_DIR%"
call npm.cmd run clone:business -- --slug "%CLIENT_SLUG%" --name "%BUSINESS_NAME%" --template "%TEMPLATE%" --catalog "%CATALOG%"
if errorlevel 1 goto :failed
popd

set "CLIENT_DIR=%WORKSPACE_DIR%\%CLIENT_SLUG%"
if not exist "%CLIENT_DIR%\package.json" (
  echo ERROR: No se creo el clon en "%CLIENT_DIR%".
  goto :failed
)
if not exist "%CLIENT_DIR%\catalogos" mkdir "%CLIENT_DIR%\catalogos"
copy /Y "%CATALOG%" "%CLIENT_DIR%\catalogos\%CLIENT_SLUG%.xlsx" >nul

echo [5/6] Instalando dependencias del clon...
pushd "%CLIENT_DIR%"
call npm.cmd install
if errorlevel 1 goto :failed
popd

for /f "delims=" %%T in ('node -e "const c=require('node:crypto'); console.log('bootstrap_'+c.randomBytes(32).toString('base64url'))"') do set "POS_BOOTSTRAP_TOKEN=%%T"
set "POS_DB_PATH=%CLIENT_DIR%\data\merxalia-pos.sqlite"
set "POS_WORKBOOK_PATH=catalogos\%CLIENT_SLUG%.xlsx"
set "POS_TIMEZONE=America/Mexico_City"
set "POS_PUBLIC_ORIGIN=%PUBLIC_URL%"
set "POS_ALLOWED_ORIGINS=%PUBLIC_URL%"
set "POS_SECURE_COOKIES=false"
set "POS_FORCE_HTTPS=false"
set "POS_TRUST_PROXY=false"
set "CONTROL_API_URL=http://localhost:3200"
set "CONTROL_CLIENT_SLUG=%CLIENT_SLUG%"
set "CONTROL_REQUIRE_HTTPS=true"

> "%CLIENT_DIR%\.pos-runtime.env" (
  echo # Archivo privado generado por INSTALAR-COMERCIAL.bat
  echo POS_DB_PATH=%POS_DB_PATH%
  echo POS_WORKBOOK_PATH=%POS_WORKBOOK_PATH%
  echo POS_TIMEZONE=%POS_TIMEZONE%
  echo POS_PUBLIC_ORIGIN=%POS_PUBLIC_ORIGIN%
  echo POS_ALLOWED_ORIGINS=%POS_ALLOWED_ORIGINS%
  echo POS_SECURE_COOKIES=%POS_SECURE_COOKIES%
  echo POS_FORCE_HTTPS=%POS_FORCE_HTTPS%
  echo POS_TRUST_PROXY=%POS_TRUST_PROXY%
  echo POS_BOOTSTRAP_TOKEN=%POS_BOOTSTRAP_TOKEN%
  echo CONTROL_API_URL=%CONTROL_API_URL%
  echo CONTROL_CLIENT_SLUG=%CONTROL_CLIENT_SLUG%
  echo CONTROL_CLIENT_SECRET=%CONTROL_CLIENT_SECRET%
  echo CONTROL_REQUIRE_HTTPS=%CONTROL_REQUIRE_HTTPS%
)
if errorlevel 1 (
  echo ERROR: No se pudo guardar la configuracion privada del POS.
  goto :failed
)
echo Configuracion privada del POS guardada en .pos-runtime.env.

echo.
echo [6/6] Instalacion terminada.
echo Bootstrap token del POS: %POS_BOOTSTRAP_TOKEN%
echo.
echo Se abrira el POS en otra ventana. Usa el bootstrap token para crear owner y admin.
echo Despues retira ese token del entorno y reinicia el POS.
start "Merxalia POS - %CLIENT_SLUG%" /D "%CLIENT_DIR%" cmd.exe /d /k "npm.cmd start"
echo.
echo Cliente creado en: %CLIENT_DIR%
echo El panel owner esta en: http://localhost:3200
echo El POS esta en: %PUBLIC_URL%
echo No cierres esta ventana hasta haber anotado los tokens mostrados.
pause
exit /b 0

:check
if not exist "%POS_DIR%\package.json" exit /b 1
if not exist "%OWNER_DIR%\package.json" exit /b 1
where node >nul 2>nul || exit /b 1
where npm >nul 2>nul || exit /b 1
echo OK: estructura, Node.js y npm disponibles.
exit /b 0

:failed
echo.
echo ERROR: Un comando fallo. Revisa el mensaje anterior.
popd >nul 2>nul
echo.
echo La ventana quedara abierta para que puedas leer el error.
pause
exit /b 1