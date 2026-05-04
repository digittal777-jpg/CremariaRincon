const { SerialPort } = require('serialport');

class ThermalPrinter {
  constructor() {
    this.port = null;
    this.isConnected = false;
  }

  async connect(portName) {
    this.port = new SerialPort({
      path: portName,
      baudRate: 9600,
    });

    return new Promise((resolve, reject) => {
      this.port.on('open', () => {
        this.isConnected = true;
        resolve();
      });
      this.port.on('error', reject);
    });
  }

  printTicket(saleData) {
    if (!this.isConnected) return;
    
    const ticket = this.formatTicket(saleData);
    this.port.write(ticket);
  }

  formatTicket(sale) {
    // Formato térmico: ESC/POS
    return `
    ╔══════════════════════╗
    ║   CREMERIA EL RINCÓN ║
    ╚══════════════════════╝
    Ticket: ${sale.id}
    Fecha: ${new Date().toLocaleString()}
    ─────────────────────
    ${sale.items.map(item => `${item.name} x${item.qty}`).join('\n')}
    ─────────────────────
    Total: $${sale.total}
    ═════════════════════
    ¡Gracias por su compra!
    \n\n\n`;
  }
}

module.exports = new ThermalPrinter();