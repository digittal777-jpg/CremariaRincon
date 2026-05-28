const test = require("node:test");
const assert = require("node:assert/strict");

const { getAdminPasswordValidationError } = require("../src/admin/auth");
const { buildBranchNameFromCode, normalizeBranchCode } = require("../src/services/branches");

test("getAdminPasswordValidationError enforces stronger admin passwords", () => {
  assert.equal(
    getAdminPasswordValidationError("1234567"),
    "La contrasena admin debe tener al menos 8 caracteres.",
  );
  assert.equal(
    getAdminPasswordValidationError("abcdefgh"),
    "La contrasena admin debe incluir letras y numeros.",
  );
  assert.equal(getAdminPasswordValidationError("admin1234"), "");
});

test("normalizeBranchCode and buildBranchNameFromCode support dynamic branches", () => {
  assert.equal(normalizeBranchCode("  Sucursal Centro  "), "sucursal-centro");
  assert.equal(normalizeBranchCode("all"), "all");
  assert.equal(buildBranchNameFromCode("la-esquina-sur"), "La Esquina Sur");
});
