# Guia de instalacion comercial

Esta guia explica como instalar Merxalia POS en otra PC y como preparar una instancia para venderla a un negocio. El sistema tiene dos aplicaciones:

- `cremeria-rincon`: POS del negocio: caja, inventario, admin y cajeros.
- `owner-control`: panel privado del propietario: clientes, planes, pagos, salud y llaves de integracion.

Cada cliente debe tener su propia base de datos, volumen, URL, slug y API key. Nunca compartas una base de datos ni una llave entre clientes.

## Instalacion automatica en Windows

Si tienes las dos carpetas juntas como en este workspace, ejecuta `INSTALAR-COMERCIAL.bat` desde `cremeria-rincon`. El instalador:

1. Comprueba Node.js y npm.
2. Instala dependencias de `owner-control`, del POS base y del clon.
3. Genera el `OWNER_CONTROL_TOKEN` si lo dejas vacio.
4. Abre `owner-control` y registra el cliente automaticamente por API.
5. Recibe la API key generada y la conecta al POS.
6. Crea el clon con plantilla y catalogo.
7. Comparte `node_modules` con el POS base mediante un junction de Windows para no duplicar espacio.
8. Genera un `POS_BOOTSTRAP_TOKEN` y abre el POS.

Los tokens solo viven en las ventanas abiertas por el instalador. Anota los valores mostrados y, despues de crear `owner` y `admin`, cierra el proceso o elimina el bootstrap del entorno antes de entregar el equipo. El BAT sirve para una instalacion local o de demostracion; para produccion en Railway conserva la configuracion indicada mas abajo.

El junction solo comparte dependencias; cada clon mantiene su propia base SQLite, catalogo, configuracion y credenciales. Si ya creaste un clon con una copia completa de `node_modules`, elimina solo esa carpeta dentro del clon y vuelve a crear el junction apuntando a `cremeria-rincon\node_modules`.

## 1. Requisitos de la nueva PC

- Windows 10/11.
- Node.js 24 o superior. Verificar con `node --version`.
- npm. Verificar con `npm --version`.
- Acceso a PowerShell.
- El codigo del proyecto, sin copiar `node_modules`, bases SQLite de otro cliente ni archivos de secretos.

Para una instalacion local, copia las carpetas `cremeria-rincon` y `owner-control`. Abre PowerShell en cada carpeta y ejecuta:

```powershell
npm.cmd install
```

No copies estos archivos desde otra PC salvo que sea una restauracion autorizada del mismo negocio:

- `data/*.sqlite`, `data/*.sqlite-wal`, `data/*.sqlite-shm`.
- `data/pos-runtime-config.json`.
- `.pos-runtime.json` y `.pos-runtime.env`.
- `node_modules`.

## 2. Tokens y credenciales necesarios

Los valores entre `< >` son ejemplos. Deben sustituirse por secretos reales y guardarse en un gestor privado, no en GitHub ni en un manual entregado al cliente.

### Obligatorios para vender con panel central

| Variable | Quien la usa | Como se obtiene |
|---|---|---|
| `OWNER_CONTROL_TOKEN` | Tu panel `owner-control` | Lo generas tu y lo configuras al iniciar el panel. Es la llave maestra del panel privado. |
| `CONTROL_API_URL` | Cada POS | URL HTTPS publica de tu `owner-control`, por ejemplo `https://control.tudominio.com`. |
| `CONTROL_CLIENT_SLUG` | Cada POS | Se crea al registrar el cliente en el panel owner, por ejemplo `abarrotes-lupita`. |
| `CONTROL_CLIENT_SECRET` | Cada POS | API key creada o rotada desde el detalle del cliente en `owner-control`. Es unica por cliente. |
| `POS_BOOTSTRAP_TOKEN` | Instalacion inicial del POS | Lo generas tu para ese cliente. Sirve una sola etapa para crear `owner` y `admin`; despues retiralo o rotalo. |

### Opcionales

| Funcion | Variables |
|---|---|
| Alertas por Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_IDS`, `TELEGRAM_API_BASE_URL` |
| Respaldos S3 compatibles | `BACKUP_ENABLED`, `BACKUP_BUCKET_ENDPOINT`, `BACKUP_BUCKET_NAME`, `BACKUP_BUCKET_REGION`, `BACKUP_ACCESS_KEY_ID`, `BACKUP_SECRET_ACCESS_KEY`, `BACKUP_PREFIX` |
| Avisos de respaldo por correo | `RESEND_API_KEY`, `BACKUP_NOTIFY_TO` |
| HTTPS directo en Node | `POS_HTTPS_CERT_PATH` y `POS_HTTPS_KEY_PATH`, o sus variables `*_B64` |

Genera secretos nuevos desde PowerShell, sin reutilizar los de otra instalacion:

```powershell
node -e "const crypto=require('node:crypto'); console.log(crypto.randomBytes(32).toString('base64url'))"
```

Para `OWNER_CONTROL_TOKEN`, puedes usar el prefijo `owner_`; para `POS_BOOTSTRAP_TOKEN`, `bootstrap_`. El prefijo solo ayuda a identificar el uso, no reemplaza la aleatoriedad.

## 3. Instalar y proteger owner-control

En la carpeta `owner-control`, define el entorno de produccion. En Railway, configura estas mismas variables en el servicio, no dependas de la sesion de PowerShell:

```powershell
$env:NODE_ENV='production'
$env:OWNER_CONTROL_TOKEN='<token-owner-largo-y-unico>'
$env:OWNER_CONTROL_DB_PATH='C:\datos\owner-control\owner-control.sqlite'
$env:OWNER_CONTROL_PORT='3200'
$env:OWNER_CONTROL_REQUIRE_CLIENT_SIGNATURE='true'
$env:OWNER_CONTROL_PUBLIC_ORIGIN='https://control.tudominio.com'
$env:OWNER_CONTROL_FORCE_HTTPS='true'
$env:OWNER_CONTROL_TRUST_PROXY='loopback,linklocal,uniquelocal'
npm.cmd start
```

En local se puede abrir `http://localhost:3200`. En produccion debe existir HTTPS real, ya sea mediante Railway/proxy o mediante certificado PEM configurado en `owner-control`.

Abre el panel, captura `OWNER_CONTROL_TOKEN` y crea un cliente por cada negocio. Guarda la API key que aparece al crear el cliente: normalmente solo se muestra completa en ese momento. Si se pierde, usa **rotar API key** y actualiza el POS.

## 4. Crear la instancia POS del cliente

Desde `cremeria-rincon`, crea un clon con slug, nombre, plantilla y catalogo:

```powershell
npm.cmd run provision:client -- --slug abarrotes-lupita --name "Abarrotes Lupita" --template abarrotes --catalog .\catalogos\abarrotes-base.xlsx --public-url https://abarrotes-lupita.tudominio.com --install-deps
```

Plantillas disponibles: `abarrotes`, `cremeria`, `dulceria`, `ferreteria`, `limpieza` y `papeleria`.

El comando genera un expediente privado en `.tmp-provisioning`. No lo subas al repositorio: contiene el `POS_BOOTSTRAP_TOKEN`.

Si solo quieres preparar el expediente sin clonar, agrega `--plan-only`. Si el clon ya existe, usa `--skip-clone`.

## 5. Configurar el POS

Para una prueba local dentro de la carpeta del clon:

```powershell
$env:POS_DB_PATH='data\merxalia-pos.sqlite'
$env:POS_WORKBOOK_PATH='catalogos\abarrotes-lupita.xlsx'
$env:POS_TIMEZONE='America/Mexico_City'
$env:POS_PUBLIC_ORIGIN='http://localhost:3100'
$env:POS_ALLOWED_ORIGINS='http://localhost:3100'
$env:POS_SECURE_COOKIES='false'
$env:POS_FORCE_HTTPS='false'
$env:POS_BOOTSTRAP_TOKEN='<bootstrap-unico-de-este-cliente>'
$env:CONTROL_API_URL='https://control.tudominio.com'
$env:CONTROL_CLIENT_SLUG='abarrotes-lupita'
$env:CONTROL_CLIENT_SECRET='<api-key-del-cliente>'
npm.cmd start
```

En Railway, usa un volumen exclusivo para el cliente y configura como minimo:

```text
NODE_ENV=production
POS_DB_PATH=/data/merxalia-pos.sqlite
POS_WORKBOOK_PATH=catalogos/abarrotes-lupita.xlsx
POS_TIMEZONE=America/Mexico_City
POS_PUBLIC_ORIGIN=https://abarrotes-lupita.tudominio.com
POS_ALLOWED_ORIGINS=https://abarrotes-lupita.tudominio.com
POS_SECURE_COOKIES=true
POS_FORCE_HTTPS=true
POS_TRUST_PROXY=loopback,linklocal,uniquelocal
POS_BOOTSTRAP_TOKEN=<bootstrap-unico-de-este-cliente>
CONTROL_API_URL=https://control.tudominio.com
CONTROL_CLIENT_SLUG=abarrotes-lupita
CONTROL_CLIENT_SECRET=<api-key-del-cliente>
CONTROL_REQUIRE_HTTPS=true
```

Regla de despliegue: `1 servicio = 1 volumen = 1 base de datos = 1 dominio = 1 negocio`.

## 6. Crear accesos iniciales

1. Abre la URL del POS.
2. Usa el flujo inicial para crear el acceso `owner` y el acceso `admin` mientras `POS_BOOTSTRAP_TOKEN` esta configurado.
3. Crea los cajeros desde admin.
4. Guarda las credenciales del negocio en un canal privado.
5. Retira el bootstrap token del entorno y reinicia el POS.

El cliente debe recibir su URL, usuarios, sucursales, plan contratado y horario de soporte. No debe recibir `OWNER_CONTROL_TOKEN` ni acceso al panel owner.

## 7. Validacion antes de cobrar la venta

Desde la raiz del clon ejecuta:

```powershell
cmd /c npm test
npm.cmd run validate:client -- --slug abarrotes-lupita --url https://abarrotes-lupita.tudominio.com
```

Prueba manualmente:

- `GET /api/health` y `GET /api/bootstrap`.
- Login de owner y admin.
- Alta de cajero y sucursal.
- Venta, cambio, reimpresion y corte.
- Exportacion a Excel.
- Preparacion offline en un dispositivo real.
- Impresion solo si se probo el modelo exacto de impresora.

## 8. Respaldos y entrega comercial

Configura un servicio/job separado para respaldos con `railway.backup.json`, un bucket exclusivo o prefijo exclusivo por cliente, y ejecuta:

```powershell
npm.cmd run backup:nightly
npm.cmd run backup:verify -- --max-age-hours 36 --output .tmp-provisioning\abarrotes-lupita-backup-verify.json
npm.cmd run readiness:pilot -- --evidence .tmp-provisioning\abarrotes-lupita-readiness.json
```

No declares el cliente listo solo por tener los tests en verde. Conserva evidencia de health, accesos, venta, corte, backup, restauracion y prueba de impresion cuando aplique.

## 9. Rotacion y respuesta a incidentes

- Si se expone `OWNER_CONTROL_TOKEN`, cambia el token del panel y reinicia `owner-control`.
- Si se expone `CONTROL_CLIENT_SECRET`, rota la API key de ese cliente y actualiza solo su POS.
- Si se expone `POS_BOOTSTRAP_TOKEN`, reemplazalo y confirma que el bootstrap ya este desactivado.
- Si se pierde una API key, rotala desde el panel owner; no la inventes manualmente.
- No publiques `data/`, expedientes `.tmp-provisioning/`, archivos `.env`, logs ni configuraciones runtime.

## Resumen de secretos por alcance

| Alcance | Secretos |
|---|---|
| Solo tuyo | `OWNER_CONTROL_TOKEN` |
| Un cliente | `CONTROL_CLIENT_SLUG`, `CONTROL_CLIENT_SECRET`, `POS_BOOTSTRAP_TOKEN` |
| Integracion opcional | Telegram, bucket S3 y Resend del servicio correspondiente |
