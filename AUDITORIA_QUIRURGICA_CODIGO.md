# Auditoria quirurgica de codigo

Fecha de corte: 2026-07-09  
Repositorios revisados:

- `C:\Users\Monitor\Desktop\proyectos\cremeria-rincon`
- `C:\Users\Monitor\Desktop\proyectos\owner-control`

Este informe inicio como diagnostico de cirugia: hallazgo, evidencia, riesgo y
tratamiento recomendado. Despues de la reparacion, tambien funciona como
bitacora postoperatoria de los cortes aplicados y las validaciones ejecutadas.

## Estado postoperatorio

Reparado en esta cirugia:

- Folios POS: ahora se calculan por maximo sufijo existente y reintentan ante
  colision `UNIQUE`.
- Rename de sucursal: ahora tambien mueve `period_closures`.
- Importacion rapida: las escrituras requieren `productId` valido y ya no usan
  busqueda parcial por nombre.
- Dependencias POS: `npm audit --omit=dev` quedo en `found 0 vulnerabilities`.
- Owner-control: rate-limit buckets, nonces HMAC y reportes health/validation
  tienen limites/retencion configurables.
- Log temporal con token owner-control: eliminado.
- Owner-control README: actualizado a integracion actual.
- Owner-control: agregado `npm test` con smoke test propio.
- Uploads POS: multer ahora usa disco temporal y limpia el archivo al finalizar.
- CSP POS y owner-control: removido `unsafe-inline`; estilos inline migrados a
  clases/atributos seguros.
- Sesion cajero: TTL backend configurable por runtime y expiracion del servidor
  respetada por el storage del navegador.
- IDs offline: ventas/caja usan `crypto.randomUUID()` cuando esta disponible.
- Selectores HTML de sucursal: ya no traen `carrizal/miradores` hardcodeados
  como opciones iniciales.

## Resumen ejecutivo

El sistema no estaba roto de forma general antes de la reparacion: la suite
completa del POS pasaba `180/180` con runtime aislado. Tras la cirugia, la
suite completa pasa `185/185` desde `npm test`, los hallazgos criticos/altos
quedaron cubiertos con pruebas focalizadas y la auditoria de dependencias esta
limpia en ambos repositorios.

El riesgo real encontrado estaba en bordes operativos:

1. El POS podia fallar al crear ventas por colision de folio si existian huecos
   o datos restaurados/importados.
2. Renombrar una sucursal dejaba los cierres semanales/mensuales pegados al
   codigo viejo.
3. La importacion rapida de inventario podia aplicar movimientos al producto
   equivocado cuando el nombre era ambiguo.
4. El POS tenia vulnerabilidades productivas reportadas por `npm audit`; fueron
   corregidas con `npm audit fix` y override controlado de `exceljs -> uuid`.
5. `owner-control` guardaba algunos estados en memoria/base sin limite duro; ya
   tiene caps/retencion.
6. Existia un log temporal local con una linea de token temporal owner-control;
   fue eliminado.
7. La deuda de hardening principal quedo reducida: CSP sin `unsafe-inline`,
   uploads a disco temporal y TTL cajero configurable.

## Validacion ejecutada

### Estado de repositorios

- `git status --short` en `cremeria-rincon`: muestra cambios esperados de esta
  cirugia pendientes de commit, incluido este informe.
- `git status --short` en `owner-control`: muestra cambios esperados de esta
  cirugia pendientes de commit, incluido el smoke test propio.

### Comandos ejecutados

```powershell
cmd /c npm audit --omit=dev
```

Resultado inicial en POS: `7 vulnerabilities (5 moderate, 2 high)`.  
Resultado posterior a reparacion: `found 0 vulnerabilities`.

```powershell
cmd /c npm audit --omit=dev
```

Resultado en `owner-control`: `found 0 vulnerabilities`.

```powershell
$files = rg --files -g "*.js" -g "!node_modules";
foreach ($file in $files) { node --check $file; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
```

Resultado en ambos repositorios: sintaxis limpia.

```powershell
cmd /c npm test
```

`npm test` ahora ejecuta `scripts/run-tests-isolated.js`, que crea un
`POS_CONFIG_PATH` temporal cuando el entorno no trae uno explicito. Resultado
POS con runtime aislado:

- Tests: `185`
- Pass: `185`
- Fail: `0`
- Duracion: `84839.9474 ms`

```powershell
cmd /c npm run
```

Resultado inicial en `owner-control`: solo existia script `start`; no habia
script `test`.  
Resultado posterior a reparacion: existe `npm test` y el smoke test pasa.

```powershell
cmd /c npm test
```

Resultado en `owner-control`: `1/1`.

## Hallazgos criticos y altos

Nota: las rutas y lineas de evidencia en los hallazgos corresponden al
diagnostico inicial. El campo `Estado` y el bloque `Tratamiento aplicado`
describen el sistema despues de la reparacion.

### 1. POS puede colisionar folios de venta

Estado: Reparado  
Severidad original: Alta  
Area: POS, ventas, integridad transaccional

Antes de la reparacion, el folio se calculaba con `COUNT(*) + 1` sobre los
tickets del dia:

- `src/services/sales.js:381`
- `src/services/sales.js:383`
- `src/db.js:671`

La tabla exige `ticket_number TEXT NOT NULL UNIQUE`, pero el generador no usaba
el maximo folio existente ni reintentaba si SQLite rechazaba el insert.

Reproduccion sobre base temporal:

```json
{"ok":false,"message":"UNIQUE constraint failed: sales.ticket_number","code":"SQLITE_CONSTRAINT_UNIQUE"}
```

Escenario reproducido:

1. Existe un folio del dia terminado en `0002`.
2. Solo hay una venta contada para ese prefijo.
3. El codigo calcula siguiente folio como `0002`.
4. SQLite rechaza la venta.

Riesgo:

- Venta perdida o error visible al cajero/admin.
- Puede ocurrir despues de restauraciones, importaciones, migraciones o datos
  con huecos.

Tratamiento aplicado:

- El generador ahora calcula el siguiente folio desde el maximo sufijo numerico
  real del prefijo diario.
- `createSale` reintenta ante colisiones `SQLITE_CONSTRAINT_UNIQUE` de
  `sales.ticket_number`.
- La prueba de integridad confirma que un hueco con `0002` no reutiliza ese
  folio y avanza a `0003`.

### 2. Renombrar sucursal no actualiza `period_closures`

Estado: Reparado  
Severidad original: Alta  
Area: POS, sucursales, cierres semanales/mensuales

Antes de la reparacion, `renameBranchReferences` actualizaba varias tablas, pero
omitia `period_closures`:

- `src/services/branches.js:85`
- `src/services/branches.js:91`
- `src/services/branches.js:100`
- `src/db.js:922`
- `src/services/periodClosures.js:592`
- `src/services/periodClosures.js:920`

Reproduccion sobre base temporal:

```json
[{"branch":"carrizal","count":1}]
```

Despues de renombrar `carrizal` a `sur`, el cierre guardado siguio viviendo
en `carrizal`.

Riesgo:

- Historial de cierres queda fragmentado.
- Listados por nueva sucursal no muestran cierres anteriores.
- Reportes semanales/mensuales pueden parecer incompletos.

Tratamiento aplicado:

- `renameBranchReferences` ahora actualiza `period_closures`.
- `test/data-integrity.test.js` cubre el cambio con un cierre guardado antes
  del rename.

### 3. Importacion rapida puede mover stock de producto equivocado

Estado: Reparado  
Severidad original: Alta  
Area: POS, inventario

Antes de la reparacion, si el payload no traia `productId` valido, el backend
intentaba resolver por nombre exacto y luego por busqueda parcial:

- `src/services/inventory.js:79`
- `src/services/inventory.js:118`
- `src/services/inventory.js:133`

Reproduccion sobre base temporal:

```json
{"query":"Oaxaca","picked":{"id":1,"name":"Queso Oaxaca","stock":10}}
```

Con dos productos parecidos, la busqueda parcial elige uno por `LENGTH(name)`
e `id`, no por confirmacion del usuario.

Riesgo:

- Entrada o salida de inventario sobre producto equivocado.
- Dificil de detectar si ambos productos son similares.
- Puede alterar stock y movimientos historicos sin error tecnico.

Tratamiento aplicado:

- Las escrituras de importacion rapida ahora exigen `productId` valido.
- La resolucion por nombre parcial ya no se usa para movimientos de stock.
- La prueba de integridad confirma que una escritura solo por nombre ambiguo se
  rechaza.

### 4. POS tiene vulnerabilidades productivas

Estado: Reparado  
Severidad original: Alta  
Area: Seguridad, dependencias

`npm audit --omit=dev` reporto:

- `tmp <0.2.6`: high, path traversal.
- `ws 8.0.0 - 8.20.1`: high, memory disclosure / memory exhaustion DoS.
- `qs 6.11.1 - 6.15.1`: moderate, DoS.
- `uuid <11.1.1`: moderate, bounds check.
- `exceljs >=3.5.0`: arrastra `uuid` vulnerable.

Resultado exacto:

```text
7 vulnerabilities (5 moderate, 2 high)
```

Tratamiento aplicado:

- Se ejecuto `npm audit fix`.
- Se agrego override controlado `exceljs -> uuid@11.1.1`.
- `cmd /c npm audit --omit=dev` queda en `found 0 vulnerabilities`.
- La suite completa y pruebas de workbook/install/export siguen pasando.

### 5. `owner-control` tiene estructuras sin limite duro global

Estado: Reparado  
Severidad original: Alta/Media  
Area: owner-control, disponibilidad, crecimiento de memoria/base

En memoria:

- `../owner-control/src/app.js:217`
- `../owner-control/src/app.js:218`
- `../owner-control/src/app.js:269`
- `../owner-control/src/app.js:342`

En el diagnostico inicial, `rateLimitBuckets` y `clientSignatureNonces` eran
`Map()` sin limite duro global de entradas. Los nonces se podaban por
expiracion, pero los buckets de rate limit tampoco mostraban poda global por
capacidad.

En base:

- `../owner-control/src/store.js:967`
- `../owner-control/src/store.js:979`
- `../owner-control/src/store.js:1673`
- `../owner-control/src/store.js:1726`

`health_reports` y `validation_reports` crecian con cada reporte. Health
deduplicaba solo si la firma consecutiva coincidia; validation insertaba
siempre.

Riesgo:

- Crecimiento gradual del SQLite.
- Consumo de memoria bajo ataques con muchas IP/rutas/nonces.
- Lentitud futura en dashboards e historial.

Tratamiento aplicado:

- `rateLimitBuckets` tiene poda por limite configurable.
- Los nonces de firma HMAC tienen limite global configurable ademas de
  expiracion.
- `health_reports` y `validation_reports` tienen retencion por cliente.
- Las pruebas validan la poda de buckets y reportes.

### 6. Log temporal local contiene linea de token owner temporal

Estado: Reparado  
Severidad original: Alta local  
Area: owner-control, secretos operativos

Existia:

```text
..\owner-control\.tmp-owner-control.err.log
```

Verificacion segura:

```text
Length: 159
ContainsTemporaryOwnerTokenLine: True
```

No se imprimio el secreto. El codigo que puede producir esa linea esta en:

- `../owner-control/server.js:243`
- `../owner-control/server.js:244`

Riesgo:

- Exposicion local de token temporal si el archivo se comparte, sube o se
  adjunta a soporte.

Tratamiento aplicado:

- Se elimino `..\owner-control\.tmp-owner-control.err.log`.
- Se confirmo que el archivo ya no existe.
- No se imprimio el secreto durante la revision.

## Hallazgos medios

### 7. Runtime local puede contaminar pruebas POS

Estado: Reparado para `npm test`  
Severidad original: Media  
Area: pruebas, configuracion, bootstrap

`readRuntimeConfigValue` prefiere el archivo runtime antes que `process.env`,
salvo cuando se pasa `preferEnv`:

- `src/runtimeConfig.js:832`
- `src/config.js:34`
- `src/config.js:55`
- `test/runtime-config.test.js:173`

Durante la validacion inicial, la suite POS paso `180/180` con
`POS_CONFIG_PATH` temporal vacio. Despues de la reparacion, `npm test` ejecuta
`scripts/run-tests-isolated.js` y la suite paso `185/185` sin leer el runtime
real por accidente.

Riesgo:

- Fallos falsos de pruebas por configuracion local.
- Dificultad para distinguir regresion real contra secreto/token incorrecto.

Tratamiento aplicado:

- `npm test` ahora crea un runtime temporal cuando no se define
  `POS_CONFIG_PATH` explicitamente.
- Las pruebas auth-heavy quedan aisladas del archivo real
  `data/pos-runtime-config.json` por defecto.

### 8. Uploads POS usaban memoria hasta 100 MB

Estado: Reparado  
Severidad original: Media  
Area: disponibilidad, uploads

El diagnostico original encontro multer con `memoryStorage()` y limite de
100 MB:

- `src/server.js:112`

Riesgo original:

- Presion de memoria por uploads grandes o repetidos.
- Mayor impacto si hay varios uploads simultaneos.

Tratamiento aplicado:

- Multer ahora usa `diskStorage()` en el directorio temporal del sistema.
- Los endpoints de instalar SQLite/Excel leen el archivo desde disco y lo
  limpian en `finally`.
- Las pruebas de instalacion de DB/Excel pasan.

### 9. CSP permitia `unsafe-inline`

Estado: Reparado  
Severidad original: Media  
Area: hardening navegador

POS:

- `src/server.js:131`

owner-control:

- `../owner-control/src/app.js:15`

Riesgo original:

- Si aparece una inyeccion HTML, `unsafe-inline` facilita ejecutar estilos
  inline y reduce el valor defensivo del CSP.

Tratamiento aplicado:

- Migrar estilos inline a clases.
- Reemplazar estilos dinamicos por clases/atributos `hidden`.
- Quitar `unsafe-inline` de POS y owner-control.
- Actualizar pruebas de hardening para exigir ausencia de `unsafe-inline`.

### 10. Sesion de cajero persiste 7 dias en navegador

Estado: Mitigado por configuracion  
Severidad original: Media  
Area: POS, seguridad local

Backend:

- `src/cashier/auth.js:13`
- `src/cashier/auth.js:194`

Frontend:

- `public/js/config.js:62`
- `public/js/storage.js:1322`
- `public/js/storage.js:1337`
- `public/js/storage.js:1367`

Esto fue util para evitar que los cajeros tengan que iniciar sesion
constantemente, pero sigue siendo un token operativo persistido en navegador.

Riesgo:

- En equipos compartidos, el acceso puede sobrevivir mas de lo esperado.
- Si alguien obtiene storage local, puede reutilizar la sesion hasta expirar.

Tratamiento aplicado:

- Se mantiene la durabilidad para no regresar al problema operativo de cajeros
  iniciando sesion a cada rato.
- El TTL backend ahora se configura por runtime con
  `POS_CASHIER_SESSION_TTL_MS`.
- El storage del navegador respeta el `expiresAt` emitido por el servidor en
  vez de inventar siempre una nueva ventana local.

### 11. IDs offline usan `Date.now()` + `Math.random()`

Estado: Reparado  
Severidad original: Media/Baja  
Area: POS, offline/idempotencia

Generacion:

- `public/js/sales.js:491`
- `public/js/sales.js:1294`
- `public/js/sales.js:1756`
- `public/js/storage.js:1444`
- `public/js/storage.js:1445`

Restricciones globales:

- `src/db.js:1222`
- `src/db.js:1230`

Riesgo:

- Muy bajo en uso normal, pero no criptograficamente fuerte.
- La unicidad es global; si dos dispositivos generan el mismo ID, uno puede
  ser tratado como duplicado.

Tratamiento aplicado:

- Los IDs offline de ventas/caja/colas usan `crypto.randomUUID()` cuando esta
  disponible.
- Si el navegador no soporta `randomUUID`, el fallback usa
  `crypto.getRandomValues`; `Math.random()` queda solo como ultimo recurso.

### 12. Defaults y HTML mantienen sucursales hardcodeadas

Estado: Reparado en UI inicial  
Severidad original: Media/Baja  
Area: POS, sucursales dinamicas, arranque/fallback

El sistema tiene soporte dinamico de sucursales. Antes de la reparacion, tambien
habia defaults visibles en HTML:

- `src/config.js:43`
- `src/config.js:46`
- `public/js/state.js:4`
- `public/js/state.js:5`
- `public/index.html:1019`
- `public/index.html:1684`
- `public/index.html:2159`

Tambien existe rehidratacion dinamica:

- `public/js/render-admin.js:560`
- `public/js/actions.js:1198`
- `public/js/actions.js:1210`

Riesgo original:

- En carga parcial, error temprano de JS o modo fallback, la UI puede mostrar
  `carrizal/miradores` aunque la configuracion real haya cambiado.

Tratamiento aplicado:

- Las opciones HTML estaticas de sucursal quedaron reducidas a placeholder.
- Las opciones reales se renderizan desde snapshot/config.
- Los defaults de `carrizal/miradores` permanecen solo como semilla/fallback de
  configuracion, no como opciones visibles iniciales.

### 13. README de owner-control esta desfasado

Estado: Reparado  
Severidad original: Baja/Media  
Area: documentacion operativa

Antes de la reparacion, el README decia que el siguiente paso era agregar al
POS un sincronizador que:

- consulte `/api/client/subscription`
- envie `/api/client/health`
- envie `/api/client/validation-report`

Evidencia:

- `../owner-control/README.md:112`
- `../owner-control/README.md:116`
- `../owner-control/README.md:118`

Pero el POS ya implementa esos flujos:

- `src/services/controlPlane.js:150`
- `src/services/controlPlane.js:321`

Riesgo:

- Confusion operativa.
- Alguien puede intentar construir de nuevo algo que ya existe.

Tratamiento aplicado:

- El README ahora describe la integracion POS actual.
- Se documentaron variables, retencion/limites y `npm test`.

### 14. owner-control no tiene script de pruebas

Estado: Reparado  
Severidad original: Baja/Media  
Area: mantenimiento

Antes de la reparacion, `../owner-control/package.json` solo definia:

```json
"scripts": {
  "start": "node server.js"
}
```

`cmd /c npm run` confirmo que no existe `test`.

Riesgo:

- Cambios futuros en owner-control dependen de pruebas desde el repo POS o de
  ejecucion manual.

Tratamiento aplicado:

- `../owner-control/package.json` ahora tiene `test: "node --test"`.
- `../owner-control/test/smoke.test.js` valida `/api/health` con SQLite
  temporal.

## No hallazgos / senales sanas

- Sintaxis JavaScript limpia en ambos repositorios.
- POS pasa `185/185` desde `cmd /c npm test` con runtime aislado por defecto.
- `owner-control` tiene `0 vulnerabilities` en dependencias productivas.
- `owner-control` tiene `npm test` propio y el smoke test pasa.
- El POS ya tiene pruebas para muchos bordes importantes: sesiones, snapshots,
  offline sales/register, hardening HTTPS, period closures, Telegram,
  workbook import/export, service worker y owner-control.
- El frontend rehidrata selectores de sucursal dinamicamente y el HTML inicial
  ya no muestra `carrizal/miradores` como opciones estaticas.

## Orden ejecutado de correccion

1. Hecho: generacion de folios POS con maximo real + retry.
2. Hecho: `period_closures` incluido en rename de sucursales y prueba de integridad.
3. Hecho: importacion rapida bloquea escrituras sin `productId` exacto.
4. Hecho: `npm audit` POS queda limpio y se valido suite completa.
5. Hecho: retencion y limites globales en `owner-control`.
6. Hecho: `.tmp-owner-control.err.log` eliminado.
7. Hecho operativo: validaciones full usan `POS_CONFIG_PATH` temporal.
8. Hecho: uploads grandes pasan a disco temporal.
9. Hecho: `unsafe-inline` retirado de CSP POS y owner-control.
10. Hecho: README de owner-control actualizado y `npm test` propio agregado.

## Criterio de cierre validado

Despues de aplicar correcciones, se ejecuto:

```powershell
cmd /c npm audit --omit=dev
```

en ambos repositorios.

```powershell
cmd /c npm test
```

en `cremeria-rincon`. Resultado: `185/185`.

Tambien se validaron pruebas focalizadas nuevas para:

- folio con hueco `0002` existente;
- rename de sucursal con `period_closures`;
- importacion rapida con nombre ambiguo;
- poda de reportes/buckets/nonces en `owner-control`.

```powershell
cmd /c npm test
```

en `owner-control`. Resultado: `1/1`.
