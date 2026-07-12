const crypto = require("node:crypto");
const zlib = require("node:zlib");

const { getDb, nowIso } = require("../db");
const {
  createHttpError,
  getBusinessProfile,
  safeJsonParse,
} = require("../utils/helpers");

const db = getDb();
const BRANDING_LOGO_MAX_BYTES = 2 * 1024 * 1024;
const BRANDING_LOGO_MIN_DIMENSION = 64;
const BRANDING_LOGO_MAX_DIMENSION = 2048;
const BRANDING_LOGO_MAX_PIXELS = 4_000_000;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
const CRC32_TABLE = Array.from({ length: 256 }, (_unused, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function assertAllowedDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height)
    || width < BRANDING_LOGO_MIN_DIMENSION || height < BRANDING_LOGO_MIN_DIMENSION
    || width > BRANDING_LOGO_MAX_DIMENSION || height > BRANDING_LOGO_MAX_DIMENSION
    || width * height > BRANDING_LOGO_MAX_PIXELS) {
    throw createHttpError(
      "El logotipo debe medir entre 64 y 2048 pixeles por lado y no superar 4 megapixeles.",
      422,
    );
  }
}

function readPngDimensions(buffer) {
  if (buffer.length < 45 || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return null;
  }
  if (buffer.readUInt32BE(8) !== 13 || buffer.toString("ascii", 12, 16) !== "IHDR") {
    throw createHttpError("El archivo PNG esta incompleto o danado.", 422);
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer[24];
  const colorType = buffer[25];
  const compression = buffer[26];
  const filter = buffer[27];
  const interlace = buffer[28];
  const colorDefinition = {
    0: { channels: 1, bitDepths: [1, 2, 4, 8, 16] },
    2: { channels: 3, bitDepths: [8, 16] },
    3: { channels: 1, bitDepths: [1, 2, 4, 8] },
    4: { channels: 2, bitDepths: [8, 16] },
    6: { channels: 4, bitDepths: [8, 16] },
  }[colorType];
  if (!colorDefinition || !colorDefinition.bitDepths.includes(bitDepth)
    || compression !== 0 || filter !== 0 || ![0, 1].includes(interlace)) {
    throw createHttpError("El archivo PNG usa un formato no valido.", 422);
  }
  assertAllowedDimensions(width, height);

  const idatChunks = [];
  let offset = 8;
  let sawIend = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > buffer.length) {
      throw createHttpError("El archivo PNG esta incompleto o danado.", 422);
    }
    const type = buffer.toString("ascii", typeStart, dataStart);
    if (crc32(buffer.subarray(typeStart, dataEnd)) !== buffer.readUInt32BE(dataEnd)) {
      throw createHttpError("El archivo PNG esta incompleto o danado.", 422);
    }
    if (type === "IDAT") {
      idatChunks.push(buffer.subarray(dataStart, dataEnd));
    }
    if (type === "IEND") {
      if (length !== 0 || chunkEnd !== buffer.length) {
        throw createHttpError("El archivo PNG esta incompleto o danado.", 422);
      }
      sawIend = true;
      break;
    }
    offset = chunkEnd;
  }
  if (!sawIend || idatChunks.length === 0) {
    throw createHttpError("El archivo PNG no contiene datos de imagen validos.", 422);
  }
  try {
    const decoded = zlib.inflateSync(Buffer.concat(idatChunks), { maxOutputLength: 40 * 1024 * 1024 });
    const bitsPerPixel = colorDefinition.channels * bitDepth;
    const scanlineBytes = (pixelWidth) => 1 + Math.ceil(pixelWidth * bitsPerPixel / 8);
    const expectedLength = interlace === 0
      ? height * scanlineBytes(width)
      : [
        [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4],
        [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2],
      ].reduce((total, [startX, startY, stepX, stepY]) => {
        const passWidth = width > startX ? Math.ceil((width - startX) / stepX) : 0;
        const passHeight = height > startY ? Math.ceil((height - startY) / stepY) : 0;
        return total + (passWidth && passHeight ? passHeight * scanlineBytes(passWidth) : 0);
      }, 0);
    if (decoded.length !== expectedLength) throw new Error("Tamano PNG inconsistente");
  } catch (_error) {
    throw createHttpError("El archivo PNG no contiene datos de imagen validos.", 422);
  }
  return { mimeType: "image/png", width, height };
}

function readJpegDimensions(buffer) {
  if (buffer.length < 12 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }
  if (buffer[buffer.length - 2] !== 0xff || buffer[buffer.length - 1] !== 0xd9) {
    throw createHttpError("El archivo JPEG esta incompleto o danado.", 422);
  }

  let offset = 2;
  let dimensions = null;
  let sawScan = false;
  while (offset < buffer.length - 1) {
    if (buffer[offset] !== 0xff) {
      if (sawScan) {
        offset += 1;
        continue;
      }
      throw createHttpError("El archivo JPEG esta incompleto o danado.", 422);
    }
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9) break;
    if (marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) {
      throw createHttpError("El archivo JPEG esta incompleto o danado.", 422);
    }
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) {
      throw createHttpError("El archivo JPEG esta incompleto o danado.", 422);
    }
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (length < 8) {
        throw createHttpError("El archivo JPEG no contiene dimensiones validas.", 422);
      }
      dimensions = {
        mimeType: "image/jpeg",
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
      };
      assertAllowedDimensions(dimensions.width, dimensions.height);
    }
    if (marker === 0xda) {
      sawScan = true;
    }
    offset += length;
  }
  if (!dimensions || !sawScan) {
    throw createHttpError("El archivo JPEG no contiene datos de imagen validos.", 422);
  }
  return dimensions;
}

function validateBusinessLogoUpload(file) {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw createHttpError("Selecciona un logotipo PNG o JPEG.", 400);
  }
  if (file.buffer.length > BRANDING_LOGO_MAX_BYTES) {
    throw createHttpError("El logotipo no puede superar 2 MiB.", 413);
  }
  const detected = readPngDimensions(file.buffer) || readJpegDimensions(file.buffer);
  if (!detected) {
    throw createHttpError("Solo se aceptan logotipos PNG o JPEG reales.", 415);
  }
  const declaredMime = String(file.mimetype || "").trim().toLowerCase();
  if (declaredMime !== detected.mimeType) {
    throw createHttpError("El tipo MIME declarado no coincide con el contenido del logotipo.", 415);
  }
  return { ...detected, content: file.buffer, byteSize: file.buffer.length };
}

function buildPublicLogoUrl(version) {
  return `/api/branding/logo/${encodeURIComponent(version)}`;
}

function saveBusinessLogo(file) {
  const validated = validateBusinessLogoUpload(file);
  const version = crypto.createHash("sha256").update(validated.content).digest("hex");
  const updatedAt = nowIso();
  const uploadedLogo = {
    url: buildPublicLogoUrl(version),
    version,
    mimeType: validated.mimeType,
    width: validated.width,
    height: validated.height,
    byteSize: validated.byteSize,
    updatedAt,
  };

  db.transaction(() => {
    const existing = db.prepare("SELECT created_at FROM business_branding_logo WHERE id = 1").get();
    db.prepare(`
      INSERT INTO business_branding_logo (
        id, content, mime_type, width, height, byte_size, version, created_at, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        mime_type = excluded.mime_type,
        width = excluded.width,
        height = excluded.height,
        byte_size = excluded.byte_size,
        version = excluded.version,
        updated_at = excluded.updated_at
    `).run(
      validated.content,
      validated.mimeType,
      validated.width,
      validated.height,
      validated.byteSize,
      version,
      existing?.created_at || updatedAt,
      updatedAt,
    );
    const row = db.prepare("SELECT branding_json FROM business_profile WHERE id = 1").get();
    const branding = safeJsonParse(row?.branding_json, {});
    db.prepare("UPDATE business_profile SET branding_json = ?, updated_at = ? WHERE id = 1")
      .run(JSON.stringify({ ...branding, uploadedLogo }), updatedAt);
  })();

  return { businessProfile: getBusinessProfile() };
}

function deleteBusinessLogo() {
  const updatedAt = nowIso();
  db.transaction(() => {
    db.prepare("DELETE FROM business_branding_logo WHERE id = 1").run();
    const row = db.prepare("SELECT branding_json FROM business_profile WHERE id = 1").get();
    const branding = safeJsonParse(row?.branding_json, {});
    delete branding.uploadedLogo;
    db.prepare("UPDATE business_profile SET branding_json = ?, updated_at = ? WHERE id = 1")
      .run(JSON.stringify(branding), updatedAt);
  })();
  return { businessProfile: getBusinessProfile() };
}

function getBusinessLogo(version) {
  const normalizedVersion = String(version || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalizedVersion)) return null;
  const row = db.prepare(`
    SELECT content, mime_type, width, height, byte_size, version, updated_at
    FROM business_branding_logo
    WHERE id = 1 AND version = ?
  `).get(normalizedVersion);
  if (!row) return null;
  return {
    content: row.content,
    mimeType: row.mime_type,
    width: Number(row.width),
    height: Number(row.height),
    byteSize: Number(row.byte_size),
    version: row.version,
    updatedAt: row.updated_at,
    etag: `"${row.version}"`,
  };
}

module.exports = {
  BRANDING_LOGO_MAX_BYTES,
  deleteBusinessLogo,
  getBusinessLogo,
  saveBusinessLogo,
  validateBusinessLogoUpload,
};
