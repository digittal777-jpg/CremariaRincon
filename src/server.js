const http = require("node:http");
const path = require("node:path");

const express = require("express");
const { Server } = require("socket.io");

const { PORT, ROOT_DIR } = require("./config");
const {
  createSale,
  ensureCatalogSeeded,
  exportWorkbookReport,
  getDashboardSnapshot,
  importCatalogFromWorkbook,
  updateProduct,
} = require("./store");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

function broadcastSnapshot(snapshot = getDashboardSnapshot()) {
  io.emit("dashboard:snapshot", snapshot);
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(ROOT_DIR, "public")));

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    generatedAt: new Date().toISOString(),
  });
});

app.get("/api/bootstrap", (_request, response) => {
  response.json(getDashboardSnapshot());
});

app.post("/api/sales", (request, response) => {
  const sale = createSale(request.body || {});
  const snapshot = getDashboardSnapshot();
  broadcastSnapshot(snapshot);

  response.status(201).json({
    sale,
    snapshot,
  });
});

app.patch("/api/products/:id", (request, response) => {
  const productId = Number(request.params.id);
  const product = updateProduct(productId, request.body || {});
  const snapshot = getDashboardSnapshot();
  broadcastSnapshot(snapshot);

  response.json({
    product,
    snapshot,
  });
});

app.post("/api/import-workbook", async (request, response) => {
  const result = await importCatalogFromWorkbook(request.body?.workbookPath);
  const snapshot = getDashboardSnapshot();
  broadcastSnapshot(snapshot);

  response.json({
    result,
    snapshot,
  });
});

app.get("/api/export-workbook", async (_request, response) => {
  const workbookBuffer = await exportWorkbookReport();
  const fileDate = new Date().toISOString().slice(0, 10);

  response.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  response.setHeader(
    "Content-Disposition",
    `attachment; filename="cremeria-rincon-export-${fileDate}.xlsx"`,
  );
  response.send(Buffer.from(workbookBuffer));
});

app.get("/", (_request, response) => {
  response.sendFile(path.join(ROOT_DIR, "public", "index.html"));
});

app.use((error, _request, response, _next) => {
  const statusCode = Number(error.statusCode) || 500;

  if (statusCode >= 500) {
    console.error(error);
  }

  response.status(statusCode).json({
    message:
      statusCode >= 500
        ? "Ocurrio un error interno en el servidor."
        : error.message,
  });
});

io.on("connection", (socket) => {
  socket.emit("dashboard:snapshot", getDashboardSnapshot());

  socket.on("disconnect", () => {
    socket.removeAllListeners();
  });
});

async function start() {
  const seedResult = await ensureCatalogSeeded();

  if (seedResult.seeded) {
    console.log(`Catalogo inicial importado desde ${seedResult.workbookPath}`);
  } else if (seedResult.reason === "workbook-not-found") {
    console.log("No se encontro el Excel para autoimportar el catalogo inicial.");
  }

  server.listen(PORT, () => {
    console.log(`POS disponible en http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
