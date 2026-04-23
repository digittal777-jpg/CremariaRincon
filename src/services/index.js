// Services index - exporta todos los servicios del negocio
const products = require("./products");
const sales = require("./sales");
const inventory = require("./inventory");
const cashiers = require("./cashiers");
const register = require("./register");
const dashboard = require("./dashboard");
const exportService = require("./export");
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
  ...settings,
  ...audit,
};