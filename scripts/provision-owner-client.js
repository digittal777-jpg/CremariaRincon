const args = process.argv.slice(2);

function getArg(name, fallback = "") {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : String(args[index + 1] || "").trim();
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

async function waitForOwnerControl(baseUrl) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch (_error) {
      // El proceso puede tardar unos segundos en escuchar el puerto.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`owner-control no respondio en ${baseUrl}.`);
}

async function main() {
  const baseUrl = getArg("url", "http://localhost:3200").replace(/\/+$/, "");
  const slug = getArg("slug");
  const businessName = getArg("name", slug);
  const clientBaseUrl = getArg("base-url", "http://localhost:3100");
  const ownerToken = String(process.env.OWNER_CONTROL_TOKEN || "").trim();

  if (!ownerToken) {
    throw new Error("Falta OWNER_CONTROL_TOKEN en el entorno.");
  }
  if (!slug) {
    throw new Error("Falta --slug.");
  }

  await waitForOwnerControl(baseUrl);
  const response = await fetch(`${baseUrl}/api/owner/clients`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Owner-Control-Token": ownerToken,
    },
    body: JSON.stringify({
      slug,
      businessName,
      baseUrl: clientBaseUrl,
      planCode: getArg("plan", "beta"),
      monthlyAmount: Number(getArg("monthly", "0")) || 0,
      status: getArg("status", "trial"),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.apiKey) {
    throw new Error(payload.message || `No se pudo crear el cliente (HTTP ${response.status}).`);
  }

  process.stdout.write(`${payload.apiKey}\n`);
}

main().catch((error) => fail(error.message));