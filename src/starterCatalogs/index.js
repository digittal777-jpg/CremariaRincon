const { starterCatalog: abarrotesCatalog } = require("./abarrotesBase");
const { starterCatalog: cremeriaCatalog } = require("./cremeriaBase");
const { starterCatalog: papeleriaCatalog } = require("./papeleriaBase");

const starterCatalogDefinitions = {
  abarrotes: {
    templateKey: "abarrotes",
    fileName: "abarrotes-base.xlsx",
    sheetName: "Catalogo",
    businessName: "Abarrotes Base",
    starterCatalog: abarrotesCatalog,
  },
  cremeria: {
    templateKey: "cremeria",
    fileName: "cremeria-base.xlsx",
    sheetName: "Catalogo",
    businessName: "Cremeria Base",
    starterCatalog: cremeriaCatalog,
  },
  papeleria: {
    templateKey: "papeleria",
    fileName: "papeleria-base.xlsx",
    sheetName: "Catalogo",
    businessName: "Papeleria Base",
    starterCatalog: papeleriaCatalog,
  },
};

function listStarterCatalogDefinitions() {
  return Object.values(starterCatalogDefinitions).map((definition) => ({ ...definition }));
}

function getStarterCatalogDefinition(templateKey) {
  return starterCatalogDefinitions[String(templateKey || "").trim().toLowerCase()] || null;
}

module.exports = {
  starterCatalogDefinitions,
  listStarterCatalogDefinitions,
  getStarterCatalogDefinition,
};
