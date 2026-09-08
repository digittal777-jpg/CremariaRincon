const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildTicketHtml,
  buildTicketText,
  normalizeTicketSale,
} = require("../src/services/printer");

test("printer service formats tickets without native serial dependencies", () => {
  const sale = normalizeTicketSale({
    id: 7,
    storeName: "Tienda Norte",
    ticketNumber: "TN-7",
    createdAt: "2026-07-05T12:00:00.000Z",
    cashier: "Caja 1",
    shift: "Tarde",
    customerName: "Mostrador",
    paymentMethod: "Efectivo",
    receivedAmount: 200,
    changeAmount: 35.5,
    total: 164.5,
    items: [
      {
        productName: "Queso",
        quantity: 1.5,
        unitPrice: 109.67,
      },
    ],
  });

  assert.equal(sale.items[0].lineTotal, 164.51);
  assert.match(buildTicketText(sale), /TN-7/);
  assert.match(buildTicketText(sale), /TOTAL:/);
});

test("printer service escapes html ticket content", () => {
  const html = buildTicketHtml({
    ticketNumber: 'T-1" onclick="boom',
    customerName: '<script>alert("cliente")</script>',
    items: [
      {
        productName: '<img src=x onerror="boom">',
        quantity: 1,
        unitPrice: 10,
        lineTotal: 10,
      },
    ],
    total: 10,
  });

  assert.match(html, /T-1&quot; onclick=&quot;boom/);
  assert.match(html, /&lt;script&gt;alert/);
  assert.match(html, /&lt;img src=x onerror=&quot;boom&quot;&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/i);
});
