# Merxalia POS

POS web para tiendas rurales y comercios de mostrador. Esta instancia esta configurada para Cremeria El Rincon y opera con Node.js, SQLite y Socket.IO desde una sola URL publica.

Guia para instalarlo en otra PC y preparar una venta comercial: [GUIA-INSTALACION-COMERCIAL.md](GUIA-INSTALACION-COMERCIAL.md).
Para hacerlo de una sentada en Windows, ejecuta [INSTALAR-COMERCIAL.bat](INSTALAR-COMERCIAL.bat) como administrador solo si tu politica de instalacion lo requiere.

## Lo que incluye hoy

- Caja con login por cajero, carrito, cobro, cambio y cortes.
- Admin protegido con sesion segura por cookie HTTP-only.
- Inventario editable, importacion rapida y auditoria de kg.
- Solicitudes de mercaderia entre caja y admin.
- Sucursales dinamicas con alta, edicion y activar/desactivar desde admin.
- Cola offline para ventas y eventos de caja con reintento y bloqueo visible si el servidor rechaza algo.
- Exportacion a Excel, restauracion desde Excel exportado y respaldo/restauracion de SQLite.

## Impresion y hardware

- El flujo actual imprime tickets 80 mm desde el navegador usando la impresora instalada en Windows o el sistema operativo.
- No prometas ESC/POS directo, apertura de cajon, corte automatico de papel, bascula o lectura serial hasta probar el modelo real del cliente.
- Si el cliente necesita ticket fisico, valida una venta de prueba y una reimpresion desde el detalle de venta antes de cerrar piloto.
- Documenta la validacion con `docs/QA-IMPRESION-HARDWARE.md`.

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

## HTTPS directo sin depender del host

Si quieres que el mismo proceso Node termine TLS y no depender al 100% de Railway o de otro proxy, ahora puedes cargar el certificado desde variables runtime manejadas por owner:

```powershell
$env:POS_PUBLIC_ORIGIN='https://pos.tudominio.com'
$env:POS_SECURE_COOKIES='true'
$env:POS_FORCE_HTTPS='true'
$env:POS_HTTPS_CERT_PATH='certs/pos-cert.pem'
$env:POS_HTTPS_KEY_PATH='certs/pos-key.pem'
$env:POS_HTTP_REDIRECT_PORT='80'
npm.cmd start
```

Tambien puedes guardar el PEM en base64 desde el panel owner con:

- `POS_HTTPS_CERT_B64`
- `POS_HTTPS_KEY_B64`
- `POS_HTTPS_CA_B64`

Notas operativas:

- `PORT` pasa a ser el puerto HTTPS real cuando cargas certificado y llave.
- `POS_HTTP_REDIRECT_PORT` es opcional y solo sirve para redirigir HTTP plano hacia el puerto HTTPS del POS.
- Si gestionas estas variables desde `owner-control`, el POS las guarda en `data/pos-runtime-config.json` y puede arrancar sin depender de Railway para leer secretos.
- Cuando cambies certificado, llave, `POS_FORCE_HTTPS`, `POS_PUBLIC_ORIGIN` o `POS_SECURE_COOKIES`, reinicia el proceso Node.
- Si el TLS termina en proxy, conserva `POS_FORCE_HTTPS=true` y ajusta `POS_TRUST_PROXY` a tus proxies reales para que el POS acepte `X-Forwarded-Proto` solo desde ellos.
- `POS_TRUST_PROXY` debe ser una lista explicita de aliases, IPs o CIDRs confiables. Evita `true` o numeros de hops porque abren spoof de headers y degradan throttles/logs.

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
- `POS_FORCE_HTTPS`
- `POS_TRUST_PROXY`
- `POS_HSTS_MAX_AGE_SECONDS`
- `POS_HTTPS_CERT_PATH`
- `POS_HTTPS_KEY_PATH`
- `POS_HTTPS_CERT_B64`
- `POS_HTTPS_KEY_B64`
- `POS_HTTP_REDIRECT_PORT`
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
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_IDS`
- `TELEGRAM_API_BASE_URL`

Si quieres clonar exactamente una instancia real hacia Railway, no partas del Excel ni del branding manual. Prepara primero una copia segura de la SQLite actual:

```powershell
npm.cmd run prepare:railway-db
```

Ese comando deja en `.tmp-railway/`:

- una copia validada de la SQLite actual;
- un reporte con `business_profile`, branding y `POS_DB_PATH` recomendado para Railway.

Para ese escenario:

- monta un volumen persistente;
- configura `POS_DB_PATH=/data/cremaria-rincon.sqlite`;
- despliega la app;
- si la instancia arranca en blanco, sube esa SQLite por `POST /api/admin/install-db`;
- reinicia y valida `GET /api/bootstrap`.

Nota critica:

- `POS_WORKBOOK_PATH` solo sirve para sembrar productos cuando la DB esta vacia;
- no restaura `business_profile`, logo ni la identidad completa del negocio.

## Actualizar la misma instancia Railway

Si solo vas a subir las mejoras nuevas al mismo servicio de Railway:

1. deja el mismo volumen y el mismo `POS_DB_PATH`;
2. confirma que ese servicio este escuchando la rama correcta, por ejemplo `prueba-ruta` para staging privado y `main` para produccion;
3. corre `cmd /c npm test`;
4. haz respaldo de la SQLite y del workbook;
5. empuja la rama que ese servicio vigila;
6. valida `GET /api/health`, `GET /api/bootstrap`, login `owner`, login `admin` y una venta de prueba.

Regla practica:

- si el cambio es solo de interfaz, flujo, auditoria, offline o logica de negocio, normalmente no necesitas nuevas variables en Railway;
- si cambias dominio, bot, backups, workbook o la forma de sembrar/restaurar una instancia, si necesitas revisar variables.

## Variantes nuevas en Railway

Para variantes nuevas, usa siempre esta regla:

- `1 servicio = 1 volumen = 1 base de datos = 1 dominio = 1 negocio`

Dos caminos seguros:

1. Espejo exacto del negocio actual:
   - corre `npm.cmd run prepare:railway-db`;
   - monta un volumen nuevo;
   - configura `POS_DB_PATH=/data/cremaria-rincon.sqlite`;
   - despliega;
   - si inicia en blanco, sube la copia por `POST /api/admin/install-db`.
2. Variante nueva desde plantilla:
   - usa `npm.cmd run clone:business -- --slug ... --name ... --template ... --catalog ...` para crear un clon local completo;
   - o usa `node scripts/seed-business-template.js --template ... --name ... --slug ... --catalog ...` sobre una DB vacia;
   - luego despliega esa variante en un servicio Railway con volumen y variables propias.

## Que mejoras nuevas piden pasos extra en Railway

- Solicitudes con alerta por celular: configura `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_IDS`, `TELEGRAM_API_BASE_URL` y revisa `POS_PUBLIC_ORIGIN`.
- Backups nocturnos: configura `BACKUP_ENABLED`, bucket S3 compatible y, si quieres aviso por correo, `RESEND_API_KEY`.
- Cambio de dominio o URL publica: actualiza `POS_PUBLIC_ORIGIN` y `POS_ALLOWED_ORIGINS`.
- Siembra por catalogo en una instancia vacia: revisa `POS_WORKBOOK_PATH`.
- Clon exacto o restauracion total: usa volumen persistente, `POS_DB_PATH` y `POST /api/admin/install-db`.
- Nuevos modulos del negocio: si son funciones internas del POS y no dependen de terceros, suelen viajar solo con el deploy; si agregan integraciones externas, casi siempre traen variables nuevas.

## Telegram para solicitudes de mercaderia

La alerta por Telegram ya esta integrada para nuevas solicitudes de mercaderia. Solo necesita configuracion:

```powershell
$env:TELEGRAM_BOT_TOKEN='123456:ABC...'
$env:TELEGRAM_CHAT_IDS='123456789,-1009876543210'
$env:TELEGRAM_API_BASE_URL='https://api.telegram.org'
```

Pasos recomendados:

1. Crea el bot con `@BotFather` y guarda el token.
2. Abre chat con el bot y manda `/start`, o agregalo al grupo donde quieres alertas.
3. Obtén los `chat_id` con:

```powershell
npm.cmd run telegram:updates
```

4. Configura `TELEGRAM_CHAT_IDS` con uno o varios IDs separados por coma.
5. Prueba el envio con:

```powershell
npm.cmd run telegram:test
```

Notas operativas:

- `POS_PUBLIC_ORIGIN` debe apuntar a la URL real de Railway para que el mensaje abra `?view=approvals&request=<id>`.
- Si `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_IDS` o `POS_PUBLIC_ORIGIN` faltan, la solicitud se crea igual pero la alerta se omite.
- Para mandar una prueba a un chat puntual sin tocar la variable global:

```powershell
node scripts/telegram-helper.js send-test --chat 123456789
```

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
- Para subir ventas antiguas guardadas offline, inicia sesion con el mismo cajero y la misma sucursal que capturaron esas ventas; si la sesion vencio, reactivala con internet y deja que la cola termine antes de cerrar caja.

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

En Railway, `railway.json` queda reservado para el servicio web de caja. Para backup nocturno crea un segundo servicio/job usando `railway.backup.json`; ejecuta `npm run backup:nightly` con cron `0 9 * * *`, pensado para correr despues del cierre del dia Mexico/Centro.

Verificar que el primer backup real sirve para piloto:

```powershell
npm.cmd run backup:verify -- --max-age-hours 36
```

Para dejar evidencia consumible por el gate comercial:

```powershell
npm.cmd run backup:verify -- --max-age-hours 36 --output .tmp-provisioning/<cliente>-backup-verify.json
```

Si el backup quedo `partial` por cola offline pendiente y queda documentado:

```powershell
npm.cmd run backup:verify -- --max-age-hours 36 --allow-partial
```

Guia de cierre Railway: `docs/RAILWAY-BACKUP-CRON.md`.

Restauracion: sigue `docs/PLAYBOOK-RESTAURACION.md` antes de declarar que un backup sirve para piloto o produccion.

## Gate comercial

Tests verdes no significan automaticamente que un cliente este listo. Copia `docs/READINESS-EVIDENCE.example.json` a `.tmp-provisioning/<cliente>-readiness.json`, llena la evidencia real, pon `backup.verifyReportPath` apuntando al JSON generado por `backup:verify --output` y ejecuta:

```powershell
npm.cmd run readiness:pilot -- --evidence .tmp-provisioning/<cliente>-readiness.json
```

El gate de piloto exige evidencia concreta: `npm test`, `npm audit --omit=dev`, soporte configurado, catalogo sin duplicados criticos, admin reducido, dispositivo offline preparado con fecha, backup verificado con fecha, bytes y ruta/llave de SQLite y Excel. Si se prometio ticket fisico, tambien exige modelo de impresora, fecha de prueba real y documento QA existente.

Para escala masiva, exige ademas cron Railway real, documento de evidencia del cron, restauracion probada y documento de evidencia de restauracion:

```powershell
npm.cmd run readiness:scale -- --evidence .tmp-provisioning/<cliente>-readiness.json
```

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
- `.\catalogos\dulceria-base.xlsx`
- `.\catalogos\ferreteria-base.xlsx`
- `.\catalogos\limpieza-base.xlsx`
- `.\catalogos\papeleria-base.xlsx`

Notas:

- `abarrotes` arranca como minisuper/tienda de barrio con marcas comunes.
- `cremeria` arranca con quesos, embutidos, refrigerados y complementos tipicos.
- `dulceria` arranca con chocolates, gomitas, paletas, botanas, fiesta y bebidas.
- `ferreteria` arranca con herramienta, fijacion, electricidad, plomeria, pintura y seguridad.
- `limpieza` arranca con quimicos, jarcieria, papel, desechables y hogar.
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
npm.cmd run clone:business -- --slug dulceria-la-pinata --name "Dulceria La Pinata" --template dulceria --catalog ".\catalogos\dulceria-base.xlsx"
npm.cmd run clone:business -- --slug ferreteria-central --name "Ferreteria Central" --template ferreteria --catalog ".\catalogos\ferreteria-base.xlsx"
npm.cmd run clone:business -- --slug limpieza-brillante --name "Limpieza Brillante" --template limpieza --catalog ".\catalogos\limpieza-base.xlsx"
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
