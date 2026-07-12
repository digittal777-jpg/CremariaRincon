# Auditoria de rendimiento APIs POS y owner-control

Generado: 2026-07-11T04:44:55.388Z

## Resumen Rafael

- POS runtime actual: CONTROL_API_URL=http://127.0.0.1:3200, CONTROL_CONFIG_POLL_MS=60000, RAILWAY_COST_SAVER_MODE=(auto).
- Estado del target actual: no alcanzable.
- POS aislado en reposo sano: 98.48 MB RSS, CPU 6.64% de un nucleo.
- owner-control aislado en reposo sano: 65.27 MB RSS, CPU 0.91% de un nucleo.
- Rutas POS medidas: 113. Rutas owner-control medidas: 19.

## Datos

- POS DB: 1.11 MB, tablas {"products":151,"sales":695,"sale_items":1068,"inventory_movements":1418,"register_events":139,"credit_payments":2,"cashier_sessions":2,"app_error_reports":0}.
- owner-control DB: 8.52 MB + WAL 0 MB, tablas {"clients":1,"payments":1,"health_reports":2149,"validation_reports":0}.
- Prueba aislada uso POS_DB_PATH y OWNER_CONTROL_DB_PATH temporales en C:\Users\Monitor\AppData\Local\Temp\cremeria-api-perf-1783745095390-12252; el auditor los elimina al terminar.

## Procesos

| Proceso | PID | RSS | Privada | CPU nucleo | CPU maquina |
| --- | --- | --- | --- | --- | --- |
| POS idle healthy polling 12s | 11784 | 98.48 MB | 113.95 MB | 6.64% | 1.66% |
| owner-control idle healthy polling 12s | 10156 | 65.27 MB | 71.59 MB | 0.91% | 0.23% |

## POS HTTP

| Ruta | Iter | Avg | P95 | Max/Total | KB | Status |
| --- | --- | --- | --- | --- | --- | --- |
| GET /api/health | 30 | 2.98 ms | 5.21 ms | 6.03 ms | 0.05 | 200:30 |
| GET /api/bootstrap?branch=carrizal | 20 | 7.63 ms | 9.86 ms | 39.43 ms | 44.89 | 200:20 |
| GET /api/cashier/auth/status | 20 | 3.3 ms | 4.47 ms | 4.51 ms | 0.12 | 200:20 |
| GET /api/dashboard?branch=carrizal | 15 | 7.11 ms | 20.34 ms | 20.34 ms | 49.51 | 200:15 |
| GET /api/register/summary?shift=Tarde | 15 | 7.36 ms | 12.58 ms | 12.58 ms | 0.35 | 200:15 |
| GET /api/receivables | 12 | 3.36 ms | 4.94 ms | 4.94 ms | 0.02 | 200:12 |
| GET /api/admin/bootstrap?branch=all&includeInactiveInventory=true | 10 | 21 ms | 104.83 ms | 104.83 ms | 119.65 | 200:10 |
| GET /api/admin/products?branch=carrizal | 15 | 23.22 ms | 106.91 ms | 106.91 ms | 20.77 | 200:15 |
| GET /api/owner/config | 12 | 29.98 ms | 33.14 ms | 33.14 ms | 24.5 | 200:12 |
| GET /api/admin/support-health?branch=all | 6 | 37.7 ms | 47.66 ms | 47.66 ms | 2.54 | 200:6 |
| GET /api/admin/profitability?period=month&branch=all | 6 | 6.96 ms | 9.22 ms | 9.22 ms | 3 | 200:6 |
| POST /api/admin/control-plane/health/report | 4 | 44.03 ms | 51.42 ms | 51.42 ms | 23.59 | 200:4 |
| POST /api/admin/control-plane/config/sync | 4 | 175.07 ms | 177.32 ms | 177.32 ms | 67.85 | 200:4 |
| POST /api/admin/control-plane/runtime-config/sync | 4 | 112.41 ms | 169.35 ms | 169.35 ms | 77.37 | 200:4 |
| GET /api/export-workbook?branch=all&scope=store-day | 2 | 151.3 ms | 193.45 ms | 193.45 ms | 40.18 | 200:2 |

## POS bursts

| Ruta | Iter | Avg | P95 | Max/Total | KB | Status |
| --- | --- | --- | --- | --- | --- | --- |
| GET /api/bootstrap?branch=carrizal | 40 |  |  | 174.99 ms | 44.89 | 200:40 |
| GET /api/dashboard?branch=carrizal | 25 |  |  | 101.41 ms | 49.51 | 200:25 |
| GET /api/admin/support-health?branch=all | 8 |  |  | 275.82 ms | 2.54 | 200:8 |
| GET /api/admin/profitability?period=month&branch=all | 8 |  |  | 39.74 ms | 3 | 200:8 |

## owner-control HTTP

| Ruta | Iter | Avg | P95 | Max/Total | KB | Status |
| --- | --- | --- | --- | --- | --- | --- |
| GET /api/health | 30 | 2.55 ms | 5.67 ms | 6.91 ms | 0.08 | 200:30 |
| GET /api/owner/clients | 20 | 3.6 ms | 5.65 ms | 5.68 ms | 17.29 | 200:20 |
| GET /api/owner/clients/cremeria-rincon | 20 | 6.37 ms | 8.35 ms | 17.64 ms | 60.29 | 200:20 |
| GET /api/owner/runtime-config | 20 | 3.14 ms | 4.82 ms | 5.2 ms | 13.92 | 200:20 |
| GET /api/owner/clients/cremeria-rincon/runtime-config | 20 | 4.38 ms | 7.62 ms | 11.78 ms | 27.32 | 200:20 |
| GET /api/client/subscription | 20 | 3.81 ms | 5.96 ms | 6.06 ms | 0.56 | 200:20 |
| GET /api/client/config | 20 | 3.61 ms | 5.81 ms | 7.88 ms | 2.33 | 200:20 |
| GET /api/client/runtime-config | 20 | 4.16 ms | 6.24 ms | 7.12 ms | 27.75 | 200:20 |
| POST /api/client/health | 12 | 4.98 ms | 7.15 ms | 7.15 ms | 17.51 | 202:12 |

## owner-control bursts

| Ruta | Iter | Avg | P95 | Max/Total | KB | Status |
| --- | --- | --- | --- | --- | --- | --- |
| GET /api/owner/clients/cremeria-rincon | 50 |  |  | 214.33 ms | 56.84 | 200:50 |
| POST /api/client/health | 50 |  |  | 251.24 ms | 17.51 | 202:50 |

## Servicios internos POS

| Operacion | Avg | P95 | Max | CPU total | Heap pico | KB |
| --- | --- | --- | --- | --- | --- | --- |
| listProducts(carrizal) | 14.49 ms | 24.93 ms | 25.11 ms | 422 ms | 3.96 MB | 20.71 |
| getDashboardSnapshot(carrizal) | 24.22 ms | 39.41 ms | 39.41 ms | 344 ms | 2.24 MB | 49.51 |
| getDashboardSnapshot(all) | 80.33 ms | 91.92 ms | 91.92 ms | 735 ms | 5.81 MB | 117.51 |
| getPublicDashboardSnapshot(carrizal) | 23.62 ms | 41.38 ms | 41.38 ms | 360 ms | 6.16 MB | 44.63 |
| getSupportHealthReport(all) | 34.04 ms | 44.83 ms | 44.83 ms | 250 ms | 3.03 MB | 2.19 |
| getProfitabilityReport(month/all) | 3.01 ms | 5.8 ms | 5.8 ms | 16 ms | 2.36 MB | 2.95 |
| listReceivableCustomers(carrizal) | 0.34 ms | 1.6 ms | 1.6 ms | 15 ms | 0.07 MB | 0 |
| exportWorkbookReport(all/store-day) | 0 ms | 0 ms | 0 ms | 62 ms | 0 MB | 0 |

## Servicios internos owner-control

| Operacion | Avg | P95 | Max | CPU total | Heap pico | KB |
| --- | --- | --- | --- | --- | --- | --- |
| owner listClients() | 0.63 ms | 0.96 ms | 2.71 ms | 32 ms | 1.79 MB | 17.15 |
| owner getClientDetail(cremeria-rincon) | 1.86 ms | 5.05 ms | 5.2 ms | 46 ms | 5.01 MB | 58.91 |
| owner getClientRuntimeConfig(cremeria-rincon) | 0.99 ms | 1.75 ms | 4.27 ms | 32 ms | 3.11 MB | 27.19 |
| owner getOwnerRuntimeConfig() | 0.35 ms | 1.33 ms | 1.62 ms | 31 ms | 1.04 MB | 14.05 |

## Hallazgos

- No hubo servicios internos POS por encima de 100 ms p95 en esta muestra.
- Las rutas HTTP POS por encima de 100 ms p95 fueron: GET /api/export-workbook?branch=all&scope=store-day p95=193.45ms; POST /api/admin/control-plane/config/sync p95=177.32ms; POST /api/admin/control-plane/runtime-config/sync p95=169.35ms; GET /api/admin/products?branch=carrizal p95=106.91ms; GET /api/admin/bootstrap?branch=all&includeInactiveInventory=true p95=104.83ms.
- Ventas del dia, soporte/salud y rentabilidad ya usan rangos SQL por fecha de tienda; esto evita filtrar historico completo en JS.
- Dashboard reutiliza ventas/items del dia dentro del snapshot y usa cache corto en rutas GET para absorber rafagas.
- Export store-day/store-week ya pide filas filtradas por alcance en vez de cargar todos los historicos antes de filtrar.
- owner-control esta razonablemente ligero por endpoint, pero health_reports crece y cada reporte ejecuta dedupe + prune; mantener retencion e indices es clave.
- CONTROL_CONFIG_POLL_MS no se ve agresivo para POS local; en Railway conviene dejarlo en 0 salvo necesidad real.
- El CONTROL_API_URL actual no respondio healthcheck; si el POS corre asi, genera intentos fallidos de fondo.

## Recomendaciones

1. Para Railway usar RAILWAY_COST_SAVER_MODE=true y CONTROL_CONFIG_POLL_MS=0; para POS local mantener 30000-60000 ms si se necesita sync central.
2. Mantener los rangos SQL en ventas, soporte/salud, rentabilidad y exportaciones para que el costo crezca con el periodo solicitado.
3. Vigilar bootstrap/admin productos si el catalogo sube mucho; el siguiente corte natural seria paginar listas administrativas grandes.
4. Separar endpoints livianos de bootstrap si el catalogo o inventario crecen por encima de miles de productos.
5. Mantener owner-control con retencion efectiva de health_reports y hacer checkpoint del WAL en mantenimiento.

## Logs de arranque

```json
{
  "pos": {
    "stdoutBytes": 45,
    "stderrBytes": 109,
    "warningLines": 0,
    "controlPlaneLines": 1,
    "samples": [
      "Servidor corriendo en http://localhost:60485",
      "[control-plane] Variables runtime sincronizadas (startup). Reinicia el POS para aplicar: POS_BOOTSTRAP_TOKEN"
    ]
  },
  "ownerControl": {
    "stdoutBytes": 161,
    "stderrBytes": 0,
    "warningLines": 0,
    "controlPlaneLines": 0,
    "samples": [
      "Owner control listo en http://localhost:60486",
      "Base owner-control: C:\\Users\\Monitor\\AppData\\Local\\Temp\\cremeria-api-perf-1783745095390-12252\\owner-control.sqlite"
    ]
  },
  "loginStatuses": {
    "admin": 200,
    "owner": 200,
    "cashier": 200
  }
}
```
