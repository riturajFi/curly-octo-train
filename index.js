import http from "http";
import "dotenv/config";
import OpenAI from "openai";
import cron from "node-cron";
import qrcode from "qrcode-terminal";
import whatsappWeb from "whatsapp-web.js";
import { CONFIG } from "./config.js";

const { Client, LocalAuth } = whatsappWeb;

const sessionPath = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? `${process.env.RAILWAY_VOLUME_MOUNT_PATH}/whatsapp-session`
  : "./whatsapp-session";
const targetNumber = process.env.TARGET_NUMBER || CONFIG.targetNumber;
const manualRunToken = process.env.MANUAL_RUN_TOKEN || CONFIG.manualRunToken;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const whatsapp = new Client({
  authStrategy: new LocalAuth({ dataPath: sessionPath }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu"
    ]
  }
});

let whatsappReady = false;
let agentRunning = false;

whatsapp.on("qr", qr => {
  console.log("\nScan this QR from WhatsApp > Linked devices > Link a device:\n");
  qrcode.generate(qr, { small: true });
});

whatsapp.on("ready", () => {
  whatsappReady = true;
  console.log("WhatsApp client is ready.");
});

whatsapp.on("auth_failure", message => {
  whatsappReady = false;
  console.error("WhatsApp auth failed:", message);
});

whatsapp.on("disconnected", reason => {
  whatsappReady = false;
  console.error("WhatsApp disconnected:", reason);
});

async function researchFundingNews() {
  const today = new Date().toISOString().slice(0, 10);

  const response = await openai.responses.create({
    model: CONFIG.openaiModel,
    tools: [{ type: "web_search_preview" }],
    input: `
You are a VC funding research agent.

Find startup funding news announced in the last 24 hours.

Search for:
- funding announced today
- startup raised seed funding
- startup raised pre-seed funding
- startup raised Series A
- startup raised Series B
- latest venture funding news
- India startup funding today
- global startup funding today

Prefer company blogs, investor blogs, TechCrunch, Crunchbase News, FinSMEs,
BusinessWire, PR Newswire, GlobeNewswire, Inc42, YourStory, Entrackr,
VCCircle, and EU-Startups.

Rules:
- Include only companies that announced funding recently.
- Exclude fund launches and old articles.
- Categorize rounds as pre_seed, seed, series_a, series_b, series_c, growth, debt, grant, or undisclosed.
- Rank by outreach priority.
- Keep it short.
- Return WhatsApp-ready text only.
- No markdown tables.

Output format:

VC Funding Brief - ${today}

1. Company - Round - Amount
Sector:
Investors:
Why reach out:
Angle:
Source:

Limit to top ${CONFIG.maxCompanies} companies.
`
  });

  return response.output_text;
}

async function sendWhatsAppMessage(text) {
  if (!whatsappReady) {
    throw new Error("WhatsApp is not ready. Scan the QR first.");
  }

  if (!targetNumber || targetNumber.includes("X")) {
    throw new Error("Set TARGET_NUMBER or config.targetNumber before sending.");
  }

  await whatsapp.sendMessage(`${targetNumber}@c.us`, text.slice(0, 3500));
}

async function runAgent() {
  if (agentRunning) {
    throw new Error("Agent is already running.");
  }

  agentRunning = true;
  console.log("Running VC funding research agent...");

  try {
    const report = await researchFundingNews();
    await sendWhatsAppMessage(report);
    console.log("Daily VC report sent.");
    return { ok: true };
  } catch (error) {
    console.error("Agent failed:", error);
    return { ok: false, error: error.message };
  } finally {
    agentRunning = false;
  }
}

function startHealthServer() {
  const port = process.env.PORT || 3000;

  http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/run") {
      const token = url.searchParams.get("token") || req.headers["x-run-token"];

      if (manualRunToken && token !== manualRunToken) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Invalid manual run token." }));
        return;
      }

      const result = await runAgent();
      res.writeHead(result.ok ? 200 : 500, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      whatsappReady,
      agentRunning,
      targetConfigured: Boolean(targetNumber && !targetNumber.includes("X")),
      time: new Date().toISOString()
    }));
  }).listen(port, () => {
    console.log(`Health server listening on ${port}`);
  });
}

whatsapp.initialize();

cron.schedule(CONFIG.cron, runAgent, {
  timezone: CONFIG.timezone
});

startHealthServer();
