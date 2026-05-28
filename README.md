# Cremeria El Rincon POS

POS web hecho con Node.js, SQLite y Socket.IO para operar caja, inventario y admin desde una sola URL publica.

## Lo que incluye hoy

- Caja con login por cajero, carrito, cobro, cambio y cortes.
- Admin protegido con sesion segura por cookie HTTP-only.
- Inventario editable, importacion rapida y auditoria de kg.
- Solicitudes de mercaderia entre caja y admin.
- Sucursales dinamicas con alta, edicion y activar/desactivar desde admin.
- Cola offline para ventas y eventos de caja con reintento y bloqueo visible si el servidor rechaza algo.
- Exportacion a Excel, restauracion desde Excel exportado y respaldo/restauracion de SQLite.

## Requisitos

- Node.js 24 o superior.
- `npm`.
- Opcional: el archivo `Queseria El rincon V1.5.xlsx` si quieres sembrar o reimportar catalogo desde Excel.

## Desarrollo local

```powershell
npm.cmd install
npm.cmd run dev
```

Si necesitas crear el primer acceso `admin` u `owner` por web, levanta el proceso con:

```powershell
$env:POS_BOOTSTRAP_TOKEN='cambia-esto-por-un-secreto-unico'
```

## Produccion local

```powershell
npm.cmd install
npm.cmd start
```

Abre `http://localhost:3100`.

## Railway y URL publica

- La app esta pensada para vivir en una sola URL publica.
- Admin, cajero y tablet entran por la misma direccion y el acceso se resuelve por autenticacion y rol.
- Para Railway conviene configurar:

```powershell
$env:POS_PUBLIC_ORIGIN='https://tu-app.railway.app'
$env:POS_ALLOWED_ORIGINS='https://tu-app.railway.app'
$env:POS_SECURE_COOKIES='true'
$env:POS_BOOTSTRAP_TOKEN='crea-un-token-largo-y-unico'
```

Variables utiles:

- `PORT`
- `POS_DB_PATH`
- `POS_TIMEZONE`
- `POS_WORKBOOK_PATH`
- `POS_PUBLIC_ORIGIN`
- `POS_ALLOWED_ORIGINS`
- `POS_SECURE_COOKIES`
- `POS_BOOTSTRAP_TOKEN`
- `POS_ADMIN_MAX_FAILED_LOGINS`
- `POS_ADMIN_LOGIN_WINDOW_MS`
- `POS_ADMIN_LOGIN_LOCK_MS`
- `BACKUP_ENABLED`
- `BACKUP_BUCKET_ENDPOINT`
- `BACKUP_BUCKET_NAME`
- `BACKUP_BUCKET_REGION`
- `BACKUP_ACCESS_KEY_ID`
- `BACKUP_SECRET_ACCESS_KEY`
- `BACKUP_PREFIX`
- `BACKUP_RETENTION_DAILY`
- `BACKUP_RETENTION_WEEKLY`
- `BACKUP_RETENTION_MONTHLY`
- `BACKUP_NOTIFY_TO`
- `RESEND_API_KEY`

## Admin seguro

- El admin ya no usa `Bearer` persistido en navegador.
- El login admin crea una sesion segura con cookie HTTP-only.
- Las mutaciones admin exigen validacion CSRF.
- El login aplica bloqueo temporal por intentos fallidos.
- El setup inicial de `admin` y `owner` queda bloqueado si no defines `POS_BOOTSTRAP_TOKEN`.
- La replantillizacion completa del negocio ya no vive en el admin normal; ahora es una accion exclusiva del `owner`.
- Si vas a exponer la URL publica, usa HTTPS real.

## Offline preparado

- El offline completo se promete solo a dispositivos ya preparados online.
- La app guarda:
  - ultimo snapshot operativo;
  - snapshots preparados por sucursal;
  - cola de ventas pendientes;
  - eventos de caja pendientes;
  - perfiles offline de cajeros ya autenticados antes.
- Si una venta offline es rechazada por el servidor, queda visible y bloqueada para revision manual; no se pierde silenciosamente.
- Si una tablet nunca cargo datos de una sucursal con internet, no podra entrar offline a esa sucursal.

## Backups recomendados

- `Railway Volume Backups` sigue siendo la primera red de seguridad del disco.
- El respaldo maestro del POS es el `.sqlite`.
- El `.xlsx` es respaldo operativo secundario.
- Si el sistema detecta equipos con cola offline pendiente o bloqueada, el backup nocturno queda marcado como `partial`.

Variables minimas para el job nocturno:

```powershell
$env:BACKUP_ENABLED='true'
$env:BACKUP_BUCKET_ENDPOINT='https://<tu-endpoint-s3>'
$env:BACKUP_BUCKET_NAME='axentra-backups'
$env:BACKUP_BUCKET_REGION='auto'
$env:BACKUP_ACCESS_KEY_ID='...'
$env:BACKUP_SECRET_ACCESS_KEY='...'
$env:BACKUP_PREFIX='clientes/cremeria-rincon'
```

Ejecutar respaldo nocturno manualmente:

```powershell
npm.cmd run backup:nightly
```

Pruebas locales sin bucket real usando carpeta temporal:

```powershell
$env:BACKUP_ENABLED='true'
$env:BACKUP_BUCKET_ENDPOINT='file:///C:/respaldos-prueba'
$env:BACKUP_BUCKET_NAME='local'
npm.cmd run backup:nightly
```

La app expone `GET /api/admin/backups/status` para ver el ultimo respaldo, su estado (`ok`, `partial`, `failed`) y el resumen de sincronizacion reportado por los clientes.

## Sucursales dinamicas

- Las sucursales ya viven en la base de datos.
- Desde admin puedes:
  - crear sucursal;
  - cambiar nombre y zona horaria;
  - activar o desactivar.
- Una sucursal inactiva conserva historial, pero ya no puede vender ni registrar nuevos movimientos operativos.

## Catalogo y restauracion

Catalogos base disponibles:

- `.\catalogos\abarrotes-base.xlsx`
- `.\catalogos\cremeria-base.xlsx`
- `.\catalogos\papeleria-base.xlsx`

Notas:

- `abarrotes` arranca como minisuper/tienda de barrio con marcas comunes.
- `cremeria` arranca con quesos, embutidos, refrigerados y complementos tipicos.
- `papeleria` arranca con utiles, oficina, arte e impresion.
- Ninguno es una copia 1:1 de una cadena comercial; sirven como base operativa editable.
- Todos vienen con stock inicial en `0` para que no arranques con inventario inventado.

Si ajustas las fuentes editables en `src/starterCatalogs/`, puedes regenerar todos los Excels con:

```powershell
npm.cmd run build:starter-catalog
```

O solo uno:

```powershell
npm.cmd run build:starter-catalog -- --template papeleria
```

Reimportar catalogo:

```powershell
npm.cmd run import:excel
```

Instalar un Excel exportado por el sistema:

```powershell
npm.cmd run install:excel-export -- ".\mi-exportacion.xlsx"
```

Crear un clon nuevo con plantilla y catalogo obligatorio:

```powershell
npm.cmd run clone:business -- --slug abarrotes-la-esquina --name "Abarrotes La Esquina" --template abarrotes --catalog ".\catalogos\abarrotes-base.xlsx"
```

Ejemplos utiles:

```powershell
npm.cmd run clone:business -- --slug cremeria-san-juan --name "Cremeria San Juan" --template cremeria --catalog ".\catalogos\cremeria-base.xlsx"
npm.cmd run clone:business -- --slug papeleria-estrella --name "Papeleria Estrella" --template papeleria --catalog ".\catalogos\papeleria-base.xlsx"
```

Sembrar una base nueva con plantilla y catalogo obligatorio:

```powershell
node scripts/seed-business-template.js --template abarrotes --name "Mi negocio" --slug mi-negocio --catalog ".\catalogos\abarrotes-base.xlsx"
```

Notas:

- La restauracion desde Excel reemplaza los datos operativos de las sucursales incluidas.
- La restauracion de SQLite sigue siendo la via mas completa cuando tienes el archivo `.sqlite`.

## Pruebas

En esta maquina, el camino mas confiable es:

```powershell
cmd /c npm test
```

## Estructura

- `src/server.js`: rutas HTTP, cookies, auth y Socket.IO.
- `src/db.js`: SQLite, tablas y semillas base.
- `src/services/`: ventas, caja, inventario, sucursales, auditoria, exportacion e importacion.
- `src/admin/auth.js`: sesion admin, CSRF y rate limit de login.
- `public/`: interfaz web de caja y admin.
- `test/`: pruebas automatizadas actuales.
