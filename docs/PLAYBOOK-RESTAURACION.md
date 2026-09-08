# Playbook de restauracion Merxalia POS

Usa este playbook cuando un cliente pierda datos, falle el volumen, se corrompa SQLite o necesites validar que un backup sirve antes de declarar el piloto listo.

## Regla de oro

No restaures encima de produccion sin conservar primero una copia de la base actual. La SQLite es el respaldo maestro; el Excel exportado es respaldo operativo secundario.

## 1. Contencion

1. Pausa ventas nuevas en el POS afectado.
2. Pide al cliente que no cierre pestanas ni borre datos del navegador si hubo modo offline.
3. En admin revisa `GET /api/admin/backups/status` o el panel de soporte:
   - ultimo backup `ok`;
   - backups `partial` con cola offline pendiente;
   - fecha y hora del ultimo reporte de sincronizacion.
4. Si hay equipos con pendientes offline, sincronizalos antes de restaurar si el servidor aun responde.

## 2. Resguardar el estado actual

En Windows local:

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item ".\data\cremeria-rincon.sqlite" ".\data\pre-restore-$stamp.sqlite"
```

En Railway, descarga primero el archivo SQLite actual del volumen o crea un backup manual del volumen. Conserva tambien el ultimo Excel exportado si existe.

## 3. Restaurar en entorno de prueba

1. Crea una carpeta temporal fuera del volumen productivo.
2. Copia ahi el `.sqlite` recuperado del backup.
3. Arranca el POS apuntando a esa copia:

```powershell
$env:POS_DB_PATH='C:\tmp\restore-test\cremeria-rincon.sqlite'
cmd /c npm test
cmd /c npm audit --omit=dev
node src/server.js
```

4. Valida en navegador:
   - login owner/admin;
   - login cajero;
   - `GET /api/health`;
   - `GET /api/bootstrap`;
   - ultima venta visible;
   - fiados y abonos visibles;
   - corte rapido o final de prueba sin guardar datos reales nuevos.

## 4. Restaurar SQLite completa

Si la prueba fue correcta:

1. Deten el servicio web del POS.
2. Copia la SQLite validada sobre la ruta productiva.
3. Conserva el archivo reemplazado como `pre-restore-<fecha>.sqlite`.
4. Reinicia el servicio.
5. Abre admin y valida `GET /api/health`, bootstrap, venta de prueba y estado de backups.

## 5. Restaurar desde Excel exportado

Usa Excel solo cuando no tengas SQLite confiable o cuando el cliente pida reinstalar catalogo operativo. Esta via puede no recuperar todo el historial tecnico.

```powershell
cmd /c npm run install:excel-export -- ".\respaldo-cliente.xlsx"
```

Despues valida productos, sucursales, inventario, ventas, fiados y caja. Si faltan datos historicos, documenta la perdida antes de entregar.

## 6. Cierre

Marca la restauracion como probada solo si:

- la app arranca con la base restaurada;
- admin y cajero pueden entrar;
- ventas, fiados, abonos y cortes clave coinciden con el cliente;
- no quedan colas offline desconocidas;
- se ejecuto un backup nuevo despues de restaurar;
- el archivo reemplazado y el archivo restaurado quedaron identificados por fecha.

