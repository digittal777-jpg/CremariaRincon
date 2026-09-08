# Tareas completas por resolver - Merxalia POS

Fecha de corte: 2026-08-16

Alcance:

- POS: `C:\Users\Monitor\Desktop\proyectos\cremeria-rincon`
- Owner-control: `C:\Users\Monitor\Desktop\proyectos\owner-control`
- Base de trabajo: auditoria comercial rural, auditoria de inconsistencias generales y cirugia tecnica ejecutada el 2026-08-15.

Estado actual verificado despues de la cirugia:

- POS: `cmd /c npm test` -> 237 pruebas pasando.
- POS: `cmd /c npm audit --omit=dev` -> 0 vulnerabilidades.
- Owner-control: `cmd /c npm test` -> 14 pruebas pasando.
- Owner-control: `cmd /c npm audit --omit=dev` -> 0 vulnerabilidades.
- Impresion por navegador 80 mm integrada desde detalle de venta.
- `serialport` eliminado del flujo de impresion.
- Soporte WhatsApp configurable agregado.
- Soporte WhatsApp agrega diagnostico prellenado desde el navegador.
- Texto offline ajustado a "equipo preparado" por cajero/sucursal/catalogo.
- Polling POS -> owner-control usa backoff y jitter ante fallas.
- `/api/health` expone servicio y version.
- `railway.backup.json` agregado como plantilla para job cron separado.
- `backup:verify` agregado para validar corridas reales de backup antes de cerrar piloto.
- Gate `readiness:pilot` / `readiness:scale` agregado para bloquear cierres sin evidencia comercial.
- `readiness` puede consumir el JSON generado por `backup:verify --output` para evitar copiar a mano bytes/rutas de respaldo.
- Ticket QA reproducible agregado para pruebas fisicas de impresora sin alterar caja ni inventario.
- Playbook de restauracion creado en `docs/PLAYBOOK-RESTAURACION.md`.
- Guias de cierre externo agregadas para impresion real y cron Railway.
- Owner-control tiene comando de poda historica de reportes con dry-run.
- Vista simple de estado para comerciante agregada al overview admin.
- Indices de mantenimiento owner-control agregados para clientes y reportes.
- Defaults visibles de branding limpiados a Merxalia.
- Preset owner "modo sencillo" agregado para reducir el admin visible.
- Estado de cuenta de fiado imprimible y compartible por WhatsApp.
- Diagnostico offline muestra causa y accion para ventas/abonos en conflicto.
- Indicador visual de equipo offline listo agregado a la sesion de cajero.
- Modo scanner dedicado y alta rapida por codigo inexistente agregados.
- Demo comercial genera ventas, fiado, abono, corte, suscripcion y productos bajos.
- Rotacion de `CONTROL_CLIENT_SECRET` tiene gracia temporal y corte inmediato opcional.
- Admin puede detectar, corregir y fusionar clientes fiados duplicados sin romper ventas ni abonos.
- Admin bootstrap ya no carga inventario completo por defecto; inventario admin usa busqueda/paginacion server-side.
- Admin inventario redisenado para tienda: entradas, salidas, conteo fisico y catalogo avanzado separados.
- Plantillas base nuevas agregadas para dulceria, limpieza y ferreteria simple con catalogos Excel probados.
- Onboarding generico CSV/Excel moderno agregado con preview, mapeo, duplicados y aplicacion segura desde admin inventario.
- Boveda Obsidian disponible en `obsidian-merxalia-pos/`.

## Leyenda de estados

| Estado | Significado |
|---|---|
| Hecho | Ya fue corregido o implementado y probado. |
| Pendiente | Debe resolverse antes de vender de forma amplia. |
| Piloto | Puede esperar para piloto controlado, pero debe cerrarse antes de escalar. |
| Futuro | No bloquea venta inicial; conviene planearlo despues. |

---

## 1. Bloqueadores P0

| Estado | Tarea | Criterio de terminado | Archivos o modulos |
|---|---|---|---|
| Hecho | Corregir vulnerabilidades productivas del POS. | `npm audit --omit=dev` devuelve `found 0 vulnerabilities`. | `package-lock.json` |
| Hecho | Quitar dependencia rota de impresion por `serialport`. | `src/services/printer.js` carga sin dependencia nativa y tiene pruebas. | `src/services/printer.js`, `test/printer-service.test.js` |
| Hecho | Integrar impresion de ticket al flujo real. | Desde detalle de venta existe boton `Imprimir ticket` y genera HTML 80 mm sanitizado. | `public/js/helpers.js`, `public/js/render.js`, `public/js/app.js` |
| Pendiente | Probar impresion con hardware real. | Prueba documentada con al menos una impresora termica Windows instalada como impresora normal; puede usar ticket QA reproducible y una venta real. | `docs/QA-IMPRESION-HARDWARE.md`, `scripts/generate-print-qa-ticket.js`, QA manual |
| Hecho | Definir mensaje comercial de impresion. | No prometer ESC/POS/cajon/bascula hasta validar hardware; vender como impresion por navegador. | README, material comercial |

---

## 2. P1 antes de primeros clientes pagados

| Estado | Tarea | Criterio de terminado | Archivos o modulos |
|---|---|---|---|
| Hecho | Crear plantilla de job backup nocturno separado. | Existe `railway.backup.json` con `npm run backup:nightly`, cron `0 9 * * *` y guia de cierre. | `railway.backup.json`, `README.md`, `docs/RAILWAY-BACKUP-CRON.md` |
| Pendiente | Crear el servicio cron real en Railway por cliente. | Railway tiene servicio separado de backup usando `railway.backup.json`; no se convierte el web service en cron. | Railway dashboard, `docs/RAILWAY-BACKUP-CRON.md` |
| Pendiente | Ejecutar primer backup real por cliente. | `backup_runs` tiene corrida `ok` o `partial` justificada; admin muestra ultimo backup y `npm run backup:verify` pasa. | `scripts/backup-nightly.js`, `scripts/verify-backup-run.js`, DB cliente |
| Hecho | Documentar playbook de restauracion. | Existe guia paso a paso para restaurar SQLite y Excel sin perder datos. | `docs/PLAYBOOK-RESTAURACION.md`, README |
| Hecho | Crear pantalla simple de estado para comerciante. | Vista no tecnica muestra internet, pendientes offline, ultimo backup, version, soporte e impresion. | `public/index.html`, `public/js/render-admin.js` |
| Hecho | Explicar offline como "equipo preparado". | UI y docs dicen claramente si el dispositivo esta listo para vender offline por sucursal/cajero. | `public/js/render.js`, README |
| Hecho | Mejorar diagnostico de cola offline bloqueada. | Cada venta o abono offline muestra causa y accion: auth vencida, sucursal equivocada, rechazo servidor, conflicto de stock/pago o pendiente red. | `public/js/helpers.js`, `public/js/network.js`, `public/js/actions.js`, tests offline |
| Hecho | Crear modo scanner dedicado. | Foco persistente en buscador, Enter del lector agrega coincidencias exactas por SKU/barcode, confirmacion visual/sonora y alta rapida si codigo no existe. | `public/index.html`, `public/js/app.js`, `test/scanner-mode.test.js` |
| Hecho | Onboarding CSV/Excel generico. | Admin permite subir CSV o Excel `.xlsx`, mapear columnas, validar duplicados, previsualizar errores y aplicar altas/actualizaciones seguras. | `src/services/productOnboardingImport.js`, `src/server.js`, admin UI, `test/data-integrity.test.js`, `test/hardening-http.test.js` |
| Hecho | Flujo para clientes fiados duplicados. | Admin puede buscar, corregir o fusionar clientes duplicados sin romper historial; prueba cubre ventas, abonos, acentos y sucursal. | `src/services/receivables.js`, `src/server.js`, `public/js/actions.js`, `public/js/render-admin.js`, `test/data-integrity.test.js` |
| Hecho | Preset admin "modo sencillo". | Owner/admin pueden ocultar secciones tecnicas por plan o rol; comerciante ve solo lo necesario. | `public/index.html`, `public/js/actions.js`, `public/js/render-admin.js` |
| Hecho | Branding de producto Merxalia. | `package.json`, README y health usan Merxalia; falta limpieza completa de defaults/logos/rutas legacy. | `package.json`, `README.md`, assets branding |
| Hecho | Limpiar branding restante. | No quedan textos visibles o defaults comerciales de `retail-base-pos` salvo compatibilidad de DB. | `public/index.html`, `src/db.js`, assets |

---

## 3. P1 tecnico de rendimiento y operacion

| Estado | Tarea | Criterio de terminado | Archivos o modulos |
|---|---|---|---|
| Hecho | Separar bootstrap admin ligero de inventario completo. | `/api/admin/bootstrap` no manda inventario completo salvo opt-in `includeInventory=1`; prueba HTTP valida payload liviano y opt-in. | `src/services/dashboard.js`, `src/server.js`, `public/js/actions.js`, `test/period-closures-http.test.js` |
| Hecho | Paginacion o busqueda server-side para admin productos. | `/api/admin/products` soporta `limit`, `offset`, `search`, `filter` e `includeInactive`; UI admin carga paginas y boton "Cargar mas". | `src/services/products.js`, `src/server.js`, `public/js/actions.js`, `public/js/render.js`, `test/hardening-http.test.js`, `test/admin-client-security.test.js` |
| Hecho | Agregar backoff y jitter al polling POS -> owner-control. | Si owner-control falla, POS reduce frecuencia y evita ruido cada minuto. | `src/server.js`, `src/services/controlPlane.js` |
| Hecho | Mejorar rotacion de `CONTROL_CLIENT_SECRET`. | Owner-control conserva hash previo temporalmente, acepta llave vieja dentro de gracia sin marcar pairing reparado, y permite `graceMinutes: 0` para corte inmediato. | `owner-control/src/store.js`, `owner-control/src/app.js`, `test/control-plane-sync.test.js` |
| Hecho | Script de poda historica de `health_reports`. | Owner-control reduce reportes antiguos existentes y conserva limite por cliente. | `owner-control/src/store.js`, `owner-control/scripts/prune-reports.js` |
| Hecho | Validar indices y mantenimiento de owner-control. | Health reports, clients y runtime sync siguen rapidos con datos historicos. | `owner-control/src/store.js`, `owner-control/test/client-pos-flow.test.js` |

---

## 4. P2 para piloto mas fuerte

| Estado | Tarea | Criterio de terminado | Archivos o modulos |
|---|---|---|---|
| Hecho | Boton de soporte configurable. | Header muestra soporte cuando `POS_SUPPORT_WHATSAPP_URL` o `POS_SUPPORT_PHONE` esta configurado. | `public/index.html`, `public/js/actions.js`, `src/config.js` |
| Hecho | Mensaje WhatsApp prellenado con diagnostico. | Link incluye negocio, pantalla, online/offline, pendientes y ultimo bloqueo local. | `public/js/actions.js`, support health |
| Hecho | Demo seed mas comercial. | Demo crea ventas, fiado, abono, corte, suscripcion, salud y productos bajos verificables para presentacion. | `scripts/seed-demo-instance.js`, `test/script-guardrails.test.js` |
| Hecho | Plantillas nuevas por giro. | Dulceria, limpieza/hogar y ferreteria simple tienen plantilla JSON, fuente starter, Excel generado y prueba de siembra en DB fresca. | `business-templates`, `src/starterCatalogs`, `catalogos`, `test/starter-catalog.test.js` |
| Hecho | Guia de reactivacion de cajero para sync. | Cajero entiende que debe iniciar sesion del mismo perfil para subir ventas antiguas. | UI offline, README |
| Hecho | Exportar o compartir historial de fiado. | Cliente puede imprimir o mandar por WhatsApp estado de cuenta sencillo; HTML impreso sanitizado y texto compartido desde datos locales/cacheados. | `public/js/receivables.js`, `public/js/app.js`, `test/offline-receivables.test.js` |
| Hecho | Alta rapida por codigo escaneado inexistente. | Al escanear codigo no registrado, usuario con acceso admin de inventario crea producto minimo con barcode, precio inicial y stock cero para corregirlo luego. | `public/js/app.js`, `/api/admin/products/manual`, `test/scanner-mode.test.js` |
| Hecho | Verificacion visual de equipo preparado offline. | La sesion muestra un indicador explicito: listo, preparar offline, reactivar cajero, pendientes por sincronizar o revision requerida. | `public/index.html`, `public/js/render.js`, `test/render-sanitization.test.js` |

---

## 5. P3 futuro, no bloquear piloto

| Estado | Tarea | Criterio de terminado | Archivos o modulos |
|---|---|---|---|
| Futuro | Integracion ESC/POS directa. | Soporta modelos definidos, puertos/configuracion y corte de papel cuando aplique. | agente local o backend hardware |
| Futuro | Abrir cajon de dinero. | Caja abre por impresora o adaptador compatible probado. | hardware local |
| Futuro | Integracion de bascula. | Lectura automatica de peso desde bascula USB/serial compatible. | agente local/hardware |
| Futuro | App instalable empacada o agente local. | Instalador para Windows que maneja hardware, autoarranque y actualizaciones. | instalador/agent |
| Futuro | WhatsApp Business oficial. | Plantillas y mensajes oficiales con API verificada. | integracion externa |
| Futuro | Cobro automatico de mensualidades. | Pasarela o Stripe/Mercado Pago sincroniza estado de suscripcion. | owner-control billing |
| Futuro | Analitica comercial avanzada. | Margenes, rotacion, canasta, alertas de compra y prediccion de stock. | reportes |
| Futuro | Control interno de rollos termicos. | Merxalia gestiona entregas, stock propio y cobro de consumibles. | sistema interno Merxalia |

---

## 6. Checklist de despliegue por cliente

1. Confirmar giro, sucursales, cajeros, dispositivos y si habra impresora.
2. Crear o validar catalogo inicial.
3. Cargar productos con costos, precios, stock inicial, unidad y codigo de barras si existe.
4. Crear owner/admin/cajeros.
5. Configurar `POS_PUBLIC_ORIGIN`, cookies seguras, HTTPS y `POS_TRUST_PROXY`.
6. Configurar `CONTROL_API_URL`, `CONTROL_CLIENT_SLUG` y `CONTROL_CLIENT_SECRET` si se usara owner-control.
7. Configurar soporte: `POS_SUPPORT_LABEL`, `POS_SUPPORT_WHATSAPP_URL` o `POS_SUPPORT_PHONE`.
8. Configurar backups: `BACKUP_ENABLED`, bucket, prefijo y retenciones.
9. Crear servicio cron separado con `railway.backup.json`.
10. Ejecutar backup manual inicial.
11. Validar `/api/health`, `/api/bootstrap`, login owner, login admin y login cajero.
12. Registrar una venta de prueba en efectivo.
13. Registrar un fiado y un abono.
14. Hacer corte rapido o final de prueba.
15. Preparar offline en cada dispositivo real.
16. Probar venta offline controlada y sincronizacion.
17. Probar impresion por navegador si se prometio ticket.
18. Descargar respaldo SQLite y validar restauracion en entorno de prueba si aplica.
19. Entregar mini guia al cliente: vender, cobrar, fiar, abonar, cortar caja y pedir soporte.
20. Registrar fecha de trial, monto, plan y siguiente contacto.
21. Llenar evidencia desde `docs/READINESS-EVIDENCE.example.json`.
22. Ejecutar `npm run readiness:pilot -- --evidence <archivo>` y conservar resultado.

---

## 7. Criterio de "listo para vender piloto"

Merxalia POS puede venderse como piloto asistido cuando:

- `npm test` pasa completo.
- `npm audit --omit=dev` esta limpio.
- Backup inicial esta probado.
- Soporte WhatsApp esta configurado.
- Cliente sabe que offline requiere equipo preparado.
- Si se promete ticket, se probo la impresora real del cliente.
- La interfaz admin queda reducida a las secciones necesarias.
- Hay catalogo inicial cargado sin duplicados criticos.
- Hay plan claro de seguimiento a los 3, 7 y 15 dias.
- `npm run readiness:pilot -- --evidence <archivo>` pasa.

## 8. Criterio de "listo para escala"

No escalar masivamente hasta cerrar:

- Backups reales por cliente con cron Railway y restauracion probada.
- `npm run readiness:scale -- --evidence <archivo>` pasa.
