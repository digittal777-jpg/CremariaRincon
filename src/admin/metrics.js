const os = require("node:os");

function getProcessCpuPercent() {
  return 0;
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