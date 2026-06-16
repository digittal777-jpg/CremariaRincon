const {
  POS_PUBLIC_ORIGIN,
  TELEGRAM_API_BASE_URL,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_IDS,
} = require("../config");
const { getBranchLabel, getBusinessProfile } = require("../utils/helpers");

const TELEGRAM_TIMEOUT_MS = 5000;

function normalizeTelegramApiBaseUrl(value = TELEGRAM_API_BASE_URL) {
  return String(value || "https://api.telegram.org").trim().replace(/\/+$/g, "");
}

function buildMerchandiseRequestDeepLink(requestId) {
  if (!POS_PUBLIC_ORIGIN) {
    return "";
  }

  let url = null;
  try {
    url = new URL(POS_PUBLIC_ORIGIN);
  } catch (_error) {
    return "";
  }

  url.hash = "";
  url.search = "";
  url.searchParams.set("view", "approvals");
  if (requestId != null) {
    url.searchParams.set("request", String(requestId));
  }
  return url.toString();
}

function formatCurrencyForNotification(value) {
  const profile = getBusinessProfile();
  const formatter = new Intl.NumberFormat(profile.locale || "es-MX", {
    style: "currency",
    currency: profile.currencyCode || "MXN",
  });
  return formatter.format(Number(value || 0));
}

function buildMerchandiseRequestAlertText(requestRecord) {
  const supplierName = String(requestRecord?.supplierName || "").trim() || "Sin proveedor";
  const lines = [
    `Nueva solicitud de mercaderia #${requestRecord.id}`,
    `Sucursal: ${getBranchLabel(requestRecord.branch)}`,
    `Cajera: ${requestRecord.requestedBy || "Sin cajera"}`,
    `Proveedor: ${supplierName}`,
    `Valor neto: ${formatCurrencyForNotification(requestRecord.totalValue)}`,
    `Lineas: ${Number(requestRecord.itemCount || 0)}`,
  ];
  const deepLink = buildMerchandiseRequestDeepLink(requestRecord?.id);
  if (deepLink) {
    lines.push(`Abrir: ${deepLink}`);
  }
  return lines.join("\n");
}

function createTimeoutController(timeoutMs = TELEGRAM_TIMEOUT_MS) {
  const controller = new AbortController();
  const timerId = setTimeout(() => {
    controller.abort(new Error(`Telegram timeout after ${timeoutMs}ms`));
  }, timeoutMs);
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timerId);
    },
  };
}

async function postTelegramMessage(chatId, text, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || TELEGRAM_TIMEOUT_MS));
  const timeoutController = createTimeoutController(timeoutMs);
  const endpoint = `${normalizeTelegramApiBaseUrl(options.apiBaseUrl)}/bot${options.botToken || TELEGRAM_BOT_TOKEN}/sendMessage`;

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal: timeoutController.signal,
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) {
      const errorDetail = payload?.description || payload?.message || "sin detalle";
      throw new Error(`Telegram respondio ${response.status}: ${errorDetail}`);
    }

    return {
      delivered: true,
      chatId,
      messageId: payload?.result?.message_id || null,
    };
  } finally {
    timeoutController.cleanup();
  }
}

async function notifyMerchandiseRequestCreated(requestRecord, options = {}) {
  const botToken = String(options.botToken || TELEGRAM_BOT_TOKEN || "").trim();
  const chatIds = Array.isArray(options.chatIds)
    ? options.chatIds.map((value) => String(value || "").trim()).filter(Boolean)
    : TELEGRAM_CHAT_IDS;
  const deepLink = buildMerchandiseRequestDeepLink(requestRecord?.id);

  if (!botToken || chatIds.length === 0) {
    return {
      delivered: false,
      skipped: true,
      reason: "telegram-not-configured",
    };
  }

  if (!deepLink) {
    return {
      delivered: false,
      skipped: true,
      reason: "public-origin-missing-or-invalid",
    };
  }

  const messageText = buildMerchandiseRequestAlertText(requestRecord);
  const settledResults = await Promise.allSettled(
    chatIds.map((chatId) =>
      postTelegramMessage(chatId, messageText, {
        apiBaseUrl: options.apiBaseUrl,
        botToken,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
      }),
    ),
  );
  const delivered = [];
  const failed = [];
  settledResults.forEach((result, index) => {
    if (result.status === "fulfilled") {
      delivered.push(result.value);
      return;
    }

    failed.push({
      chatId: chatIds[index],
      message: result.reason?.message || String(result.reason || "error"),
    });
  });

  return {
    delivered: delivered.length > 0,
    skipped: false,
    attemptedChatIds: chatIds,
    deliveredCount: delivered.length,
    failedCount: failed.length,
    deliveredChatIds: delivered.map((item) => item.chatId),
    failed,
    deepLink,
  };
}

module.exports = {
  buildMerchandiseRequestAlertText,
  buildMerchandiseRequestDeepLink,
  notifyMerchandiseRequestCreated,
  postTelegramMessage,
};
