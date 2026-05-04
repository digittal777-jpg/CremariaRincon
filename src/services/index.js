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
};
