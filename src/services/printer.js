const DEFAULT_STORE_NAME = "Merxalia POS";

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
  }).format(toNumber(value));
}

function formatQuantity(value) {
  return new Intl.NumberFormat("es-MX", {
    maximumFractionDigits: 3,
  }).format(toNumber(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeTicketSale(sale = {}) {
  const items = Array.isArray(sale.items)
    ? sale.items
    : Array.isArray(sale.lines)
      ? sale.lines
      : [];

  return {
    storeName: sale.storeName || sale.businessName || DEFAULT_STORE_NAME,
    ticketNumber: sale.ticketNumber || `Ticket #${sale.id || ""}`,
    createdAt: sale.createdAt || new Date().toISOString(),
    cashier: sale.cashier || "Cajero",
    shift: sale.shift || "",
    customerName: sale.customerName || "Mostrador",
    paymentMethod: sale.paymentMethod || "Efectivo",
    receivedAmount: roundMoney(sale.receivedAmount || 0),
    changeAmount: roundMoney(sale.changeAmount || 0),
    total: roundMoney(sale.total || 0),
    notes: String(sale.notes || "").trim(),
    items: items.map((item) => {
      const quantity = toNumber(item.quantity ?? item.qty ?? 0);
      const unitPrice = roundMoney(item.unitPrice ?? item.price ?? 0);
      return {
        productName: item.productName || item.name || "Producto",
        quantity,
        unitPrice,
        lineTotal: roundMoney(item.lineTotal ?? quantity * unitPrice),
      };
    }),
  };
}

function buildTicketText(sale) {
  const ticket = normalizeTicketSale(sale);
  const lines = [
    ticket.storeName,
    ticket.ticketNumber,
    new Intl.DateTimeFormat("es-MX", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(ticket.createdAt)),
    "--------------------------------",
    `Cajero: ${ticket.cashier}${ticket.shift ? ` / ${ticket.shift}` : ""}`,
    `Cliente: ${ticket.customerName}`,
    "--------------------------------",
  ];

  ticket.items.forEach((item) => {
    lines.push(item.productName);
    lines.push(`${formatQuantity(item.quantity)} x ${formatCurrency(item.unitPrice)} = ${formatCurrency(item.lineTotal)}`);
  });

  lines.push("--------------------------------");
  lines.push(`TOTAL: ${formatCurrency(ticket.total)}`);
  lines.push(`Metodo: ${ticket.paymentMethod}`);
  lines.push(`Recibido: ${formatCurrency(ticket.receivedAmount)}`);
  lines.push(`Cambio: ${formatCurrency(ticket.changeAmount)}`);
  if (ticket.notes) {
    lines.push("--------------------------------");
    lines.push(`Nota: ${ticket.notes}`);
  }
  lines.push("--------------------------------");
  lines.push("Gracias por su compra");
  lines.push("");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function buildTicketHtml(sale) {
  const ticket = normalizeTicketSale(sale);

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(ticket.ticketNumber)}</title>
  <style>
    @page { size: 80mm auto; margin: 4mm; }
    body { width: 72mm; margin: 0; font-family: monospace; font-size: 11px; color: #111; }
    h1 { margin: 0 0 2mm; font-size: 16px; text-align: center; }
    .center { text-align: center; }
    .rule { border-top: 1px dashed #111; margin: 3mm 0; }
    .row { display: flex; justify-content: space-between; gap: 3mm; }
    .item { margin-bottom: 2mm; }
    .item strong { display: block; }
    .total { font-size: 14px; font-weight: 700; }
  </style>
</head>
<body>
  <h1>${escapeHtml(ticket.storeName)}</h1>
  <div class="center">${escapeHtml(ticket.ticketNumber)}</div>
  <div class="center">${escapeHtml(new Intl.DateTimeFormat("es-MX", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(ticket.createdAt)))}</div>
  <div class="rule"></div>
  <div>Cajero: ${escapeHtml(ticket.cashier)}${ticket.shift ? ` / ${escapeHtml(ticket.shift)}` : ""}</div>
  <div>Cliente: ${escapeHtml(ticket.customerName)}</div>
  <div class="rule"></div>
  ${ticket.items.map((item) => `
    <div class="item">
      <strong>${escapeHtml(item.productName)}</strong>
      <div class="row">
        <span>${escapeHtml(formatQuantity(item.quantity))} x ${formatCurrency(item.unitPrice)}</span>
        <span>${formatCurrency(item.lineTotal)}</span>
      </div>
    </div>
  `).join("")}
  <div class="rule"></div>
  <div class="row total"><span>Total</span><span>${formatCurrency(ticket.total)}</span></div>
  <div>Metodo: ${escapeHtml(ticket.paymentMethod)}</div>
  <div>Recibido: ${formatCurrency(ticket.receivedAmount)}</div>
  <div>Cambio: ${formatCurrency(ticket.changeAmount)}</div>
  ${ticket.notes ? `<div class="rule"></div><div>Nota: ${escapeHtml(ticket.notes)}</div>` : ""}
  <div class="rule"></div>
  <div class="center">Gracias por su compra</div>
</body>
</html>`;
}

module.exports = {
  buildTicketHtml,
  buildTicketText,
  normalizeTicketSale,
};
