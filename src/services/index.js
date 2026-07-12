const products = require("./products");
const sales = require("./sales");
const inventory = require("./inventory");
const cashiers = require("./cashiers");
const register = require("./register");
const dashboard = require("./dashboard");
const exportService = require("./export");
const workbookImport = require("./workbookImport");
const settings = require("./settings");
const audit = require("./audit");
const merchandiseRequests = require("./merchandiseRequests");
const weightedAudit = require("./weightedAudit");
const receivables = require("./receivables");
const branches = require("./branches");
const businessProfile = require("./businessProfile");
const templateProvisioning = require("./templateProvisioning");
const backups = require("./backups");
const periodClosures = require("./periodClosures");
const profitability = require("./profitability");
const subscription = require("./subscription");
const controlPlane = require("./controlPlane");
const errorReports = require("./errorReports");
const supportHealth = require("./supportHealth");
const { assertModuleEnabled } = require("../utils/helpers");
const ownerConsole = require("./ownerConsole");
const ownerOperations = require("./ownerOperations");
const businessBranding = require("./businessBranding");

module.exports = {
  ...products,
  ...sales,
  ...inventory,
  ...cashiers,
  ...register,
  ...dashboard,
  ...exportService,
  ...workbookImport,
  ...settings,
  ...audit,
  ...merchandiseRequests,
  ...weightedAudit,
  ...receivables,
  ...branches,
  ...businessProfile,
  ...templateProvisioning,
  ...backups,
  ...periodClosures,
  ...profitability,
  ...subscription,
  ...controlPlane,
  ...errorReports,
  ...supportHealth,
  ...ownerConsole,
  ...ownerOperations,
  ...businessBranding,
  assertModuleEnabled,
};
