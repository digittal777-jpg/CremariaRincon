const os = require("node:os");

function getProcessCpuPercent() {
  // Esta función necesita acceso al estado global de CPU
  // Se pasará como dependencia o se manejará en el server.js
  return 0; // Placeholder - se implementará en server.js
}

function getSystemMetrics() {
  const memoryUsage = process.memoryUsage();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();

  return {
    generatedAt: new Date().toISOString(),
    process: {
      pid: process.pid,
      platform: process.platform,
      nodeVersion: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      rssMb: Math.round((memoryUsage.rss / 1024 / 1024) * 10) / 10,
      heapUsedMb: Math.round((memoryUsage.heapUsed / 1024 / 1024) * 10) / 10,
      heapTotalMb: Math.round((memoryUsage.heapTotal / 1024 / 1024) * 10) / 10,
    },
    system: {
      cpuCount: os.cpus().length,
      totalMemoryMb: Math.round((totalMemory / 1024 / 1024) * 10) / 10,
      freeMemoryMb: Math.round((freeMemory / 1024 / 1024) * 10) / 10,
      usedMemoryPercent:
        Math.round((((totalMemory - freeMemory) / Math.max(totalMemory, 1)) * 100) * 10) / 10,
    },
  };
}

module.exports = {
  getSystemMetrics,
};