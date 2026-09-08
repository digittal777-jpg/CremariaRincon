#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const { buildTicketHtml, buildTicketText } = require("../src/services/printer");

const ROOT_DIR = path.resolve(__dirname, "..");

function getFlagValue(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return "";
  }
  return String(process.argv[index + 1] || "").trim();
}

function resolveOutputDir(value) {
  const rawPath = String(value || ".tmp-provisioning/print-qa").trim();
  return path.isAbsolute(rawPath) ? rawPath : path.join(ROOT_DIR, rawPath);
}

function buildQaSale(options = {}) {
  const now = new Date();
  const ticketStamp = now.toISOString().replace(/[-:T.Z]/g, "").slice(0, 12);
  return {
    storeName: options.storeName || "Merxalia POS QA",
    ticketNumber: options.ticketNumber || `QA-${ticketStamp}`,
    createdAt: now.toISOString(),
    cashier: options.cashier || "Caja QA",
    shift: options.shift || "Prueba",
    customerName: "Mostrador",
    paymentMethod: "Efectivo",
    receivedAmount: 500,
    changeAmount: 143.25,
    total: 356.75,
    notes: "Ticket QA para validar impresora 80mm. No es una venta real.",
    items: [
      {
        productName: "Producto corto",
        quantity: 2,
        unitPrice: 35.5,
        lineTotal: 71,
      },
      {
        productName: "Producto con nombre largo para revisar ancho 80 mm",
        quantity: 1,
        unitPrice: 125.75,
        lineTotal: 125.75,
      },
      {
        productName: "Articulo decimal kg",
        quantity: 1.75,
        unitPrice: 91.4286,
        lineTotal: 160,
      },
    ],
  };
}

function main() {
  const outputDir = resolveOutputDir(getFlagValue("out"));
  const sale = buildQaSale({
    storeName: getFlagValue("store") || "",
    ticketNumber: getFlagValue("ticket") || "",
  });
  fs.mkdirSync(outputDir, { recursive: true });

  const safeTicket = sale.ticketNumber.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
  const htmlPath = path.join(outputDir, `${safeTicket}.html`);
  const textPath = path.join(outputDir, `${safeTicket}.txt`);
  const metaPath = path.join(outputDir, `${safeTicket}.json`);

  fs.writeFileSync(htmlPath, buildTicketHtml(sale), "utf8");
  fs.writeFileSync(textPath, buildTicketText(sale), "utf8");
  fs.writeFileSync(metaPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    htmlPath,
    textPath,
    ticketNumber: sale.ticketNumber,
    expectedTotal: sale.total,
    expectedReceived: sale.receivedAmount,
    expectedChange: sale.changeAmount,
  }, null, 2), "utf8");

  console.log(`Ticket QA HTML: ${htmlPath}`);
  console.log(`Ticket QA TXT: ${textPath}`);
  console.log(`Metadata: ${metaPath}`);
}

main();
