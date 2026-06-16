const {
  POS_PUBLIC_ORIGIN,
  TELEGRAM_API_BASE_URL,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_IDS,
} = require("../src/config");

function normalizeApiBaseUrl(value = TELEGRAM_API_BASE_URL) {
  return String(value || "https://api.telegram.org").trim().replace(/\/+$/g, "");
}

function getBotToken() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) {
    throw new Error("Falta TELEGRAM_BOT_TOKEN en el entorno.");
  }
  return token;
}

function getConfiguredChatIds() {
  return Array.isArray(TELEGRAM_CHAT_IDS)
    ? TELEGRAM_CHAT_IDS.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
}

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv.slice(2) : [];
  const command = args[0] || "help";
  const options = {
    command,
    chatIds: [],
    messageParts: [],
  };

  for (let index = 1; index < args.length; index += 1) {
    const current = args[index];
    if (current === "--chat" || current === "--chat-id") {
      const next = String(args[index + 1] || "").trim();
      if (next) {
        options.chatIds.push(next);
        index += 1;
      }
      continue;
    }
    options.messageParts.push(current);
  }

  return options;
}

async function telegramRequest(method, payload = undefined) {
  const token = getBotToken();
  const endpoint = `${normalizeApiBaseUrl()}/bot${token}/${method}`;
  const response = await fetch(endpoint, {
    method: payload ? "POST" : "GET",
    headers: payload
      ? {
          "Content-Type": "application/json",
        }
      : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok === false) {
    const detail = body?.description || body?.message || "sin detalle";
    throw new Error(`Telegram respondio ${response.status}: ${detail}`);
  }
  return body?.result;
}

function formatChatLabel(chat = {}) {
  const id = String(chat.id || "");
  const type = String(chat.type || "desconocido");
  const title = String(chat.title || "").trim();
  const firstName = String(chat.first_name || "").trim();
  const lastName = String(chat.last_name || "").trim();
  const username = String(chat.username || "").trim();
  const name = title || [firstName, lastName].filter(Boolean).join(" ") || username || "sin nombre";
  return `${id} | ${type} | ${name}${username ? ` | @${username}` : ""}`;
}

function buildDefaultTestMessage() {
  const lines = [
    "Prueba de Telegram desde Cremeria El Rincon POS.",
    `Fecha: ${new Date().toISOString()}`,
  ];
  if (POS_PUBLIC_ORIGIN) {
    lines.push(`App: ${POS_PUBLIC_ORIGIN}`);
  }
  return lines.join("\n");
}

async function runUpdatesCommand() {
  const updates = await telegramRequest("getUpdates");
  const uniqueChats = new Map();

  updates.forEach((update) => {
    const chat = update?.message?.chat
      || update?.channel_post?.chat
      || update?.my_chat_member?.chat
      || update?.chat_join_request?.chat
      || null;
    if (!chat?.id) {
      return;
    }
    uniqueChats.set(String(chat.id), chat);
  });

  console.log("Chats detectados por getUpdates:");
  if (uniqueChats.size === 0) {
    console.log("- No vi chats todavia. Escribele al bot o agregalo al grupo y manda un mensaje primero.");
    return;
  }

  [...uniqueChats.values()].forEach((chat) => {
    console.log(`- ${formatChatLabel(chat)}`);
  });
}

async function runSendTestCommand(options) {
  const explicitChatIds = options.chatIds.map((value) => String(value || "").trim()).filter(Boolean);
  const chatIds = explicitChatIds.length > 0 ? explicitChatIds : getConfiguredChatIds();
  if (chatIds.length === 0) {
    throw new Error("No hay chat IDs. Usa TELEGRAM_CHAT_IDS o pasa --chat <id>.");
  }

  const messageText = options.messageParts.length > 0
    ? options.messageParts.join(" ").trim()
    : buildDefaultTestMessage();

  const results = await Promise.allSettled(
    chatIds.map((chatId) =>
      telegramRequest("sendMessage", {
        chat_id: chatId,
        text: messageText,
        disable_web_page_preview: true,
      })),
  );

  console.log("Resultado de prueba Telegram:");
  results.forEach((result, index) => {
    const chatId = chatIds[index];
    if (result.status === "fulfilled") {
      console.log(`- OK chat ${chatId} mensaje ${result.value?.message_id || "sin-id"}`);
      return;
    }
    console.log(`- FAIL chat ${chatId}: ${result.reason?.message || String(result.reason || "error")}`);
  });
}

function printUsage() {
  console.log("Uso:");
  console.log("  node scripts/telegram-helper.js updates");
  console.log("  node scripts/telegram-helper.js send-test");
  console.log("  node scripts/telegram-helper.js send-test --chat <id>");
  console.log("  node scripts/telegram-helper.js send-test --chat <id> Mensaje de prueba");
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.command === "updates") {
    await runUpdatesCommand();
    return;
  }
  if (options.command === "send-test") {
    await runSendTestCommand(options);
    return;
  }
  printUsage();
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
