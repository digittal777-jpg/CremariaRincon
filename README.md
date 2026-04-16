# Cremeria El Rincon POS

Punto de venta profesional hecho con Node.js para registrar ventas, monitorear inventario y ver actividad en tiempo real desde una sola interfaz.

## Lo que incluye

- Caja rapida con carrito, cobro, cambio y turnos.
- Inventario editable con alertas de stock.
- Panel en tiempo real con ventas recientes, resumen del dia y ventas por hora.
- Base de datos local en SQLite.
- Importacion inicial del catalogo desde tu archivo de Excel.

## Requisitos

- Node.js 24 o superior.
- El archivo `Queseria El rincon V1.5.xlsx` ya puede vivir dentro del proyecto en la raiz:
  - `C:\Users\Cristina\Desktop\CremariaRicon\Queseria El rincon V1.5.xlsx`
- Si prefieres otra ubicacion, puedes personalizar `POS_WORKBOOK_PATH`.

## Como iniciar

```powershell
npm.cmd install
npm.cmd start
```

Abre `http://localhost:3100`.

## Desarrollo

```powershell
npm.cmd run dev
```

## Modo offline en Railway

- La app guarda una copia local del catalogo, ventas recientes, inventario y cola de operaciones pendientes en el navegador.
- Despues de abrir la pagina con internet y dejar que carguen los productos al menos una vez, puedes recargar sin conexion y seguir trabajando con el ultimo estado guardado.
- Las ventas y ajustes hechos sin internet se guardan localmente y se sincronizan cuando vuelve la conexion.
- Si entras por primera vez sin que el catalogo se haya sincronizado antes, no habra datos locales para mostrar.

## Reimportar catalogo

Desde la interfaz puedes usar el boton `Reimportar catalogo`, o desde terminal:

```powershell
npm.cmd run import:excel
```

Si necesitas otra ruta:

```powershell
$env:POS_WORKBOOK_PATH='.\Queseria El rincon V1.5.xlsx'
npm.cmd run import:excel
```

Tambien puedes apuntarlo a cualquier otra carpeta:

```powershell
$env:POS_WORKBOOK_PATH='C:\ruta\mi-archivo.xlsx'
npm.cmd run import:excel
```

## Estructura

- `src/server.js`: servidor HTTP y Socket.IO.
- `src/store.js`: logica de ventas, inventario y dashboard.
- `src/db.js`: inicializacion de SQLite.
- `src/catalogParser.js`: lectura del Excel.
- `public/`: interfaz web.

## Notas

- La base de datos se guarda en `data/cremaria-rincon.sqlite`.
- La primera vez que arranca, el sistema importa el catalogo automaticamente si encuentra el Excel en `POS_WORKBOOK_PATH`, en la raiz del proyecto o en `Downloads`.
- Los productos arrancan como `Pendiente` hasta que captures inventario o registres movimiento en ellos.
