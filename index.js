import http from "http";
import "dotenv/config";
import { readdir, rm } from "fs/promises";
import path from "path";
import OpenAI from "openai";
import cron from "node-cron";
import QRCode from "qrcode";
import whatsappWeb from "whatsapp-web.js";
import { CONFIG } from "./config.js";

const { Client, LocalAuth, NoAuth } = whatsappWeb;

const sessionPath = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? `${process.env.RAILWAY_VOLUME_MOUNT_PATH}/whatsapp-session`
  : "./whatsapp-session";
const isRailway = Boolean(process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
const persistWhatsAppSession = process.env.PERSIST_WHATSAPP_SESSION === "true" ||
  (!isRailway && process.env.PERSIST_WHATSAPP_SESSION !== "false");
const targetNumber = process.env.TARGET_NUMBER || CONFIG.targetNumber;
const manualRunToken = process.env.MANUAL_RUN_TOKEN || CONFIG.manualRunToken;
const readyWarnMs = Number(process.env.WHATSAPP_READY_WARN_MS || 90000);
const diagnosticIntervalMs = Number(process.env.WHATSAPP_DIAGNOSTIC_INTERVAL_MS || 30000);
const clearChromeLocksOnStart = process.env.CLEAR_CHROME_LOCKS === "true";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const whatsapp = new Client({
  authStrategy: persistWhatsAppSession
    ? new LocalAuth({ dataPath: sessionPath })
    : new NoAuth(),
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
let whatsappState = "starting";
let agentRunning = false;
let lastWhatsAppEventAt = Date.now();
let lastQrDataUrl = "";
let lastQrAt = "";

function markWhatsAppEvent(state) {
  whatsappState = state;
  lastWhatsAppEventAt = Date.now();
}

function maskNumber(number) {
  if (!number) return "missing";
  if (number.includes("X")) return "placeholder";
  return `${number.slice(0, 2)}***${number.slice(-4)}`;
}

function logStartupDiagnostics() {
  console.log("Startup config:", JSON.stringify({
    sessionPath,
    isRailway,
    persistWhatsAppSession,
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
    targetNumber: maskNumber(targetNumber),
    targetNumberHasPlus: Boolean(targetNumber?.includes("+")),
    manualRunProtected: Boolean(manualRunToken),
    clearChromeLocksOnStart,
    timezone: CONFIG.timezone,
    cron: CONFIG.cron,
    openaiModel: CONFIG.openaiModel
  }));

  if (!process.env.OPENAI_API_KEY) {
    console.error("Missing OPENAI_API_KEY. Add it to .env before running /run.");
  }

  if (!targetNumber || targetNumber.includes("X") || targetNumber.includes("+")) {
    console.error("Invalid TARGET_NUMBER. Use country code only, no +. Example: 918917200633");
  }
}

async function findChromeLockFiles(dir, depth = 0) {
  if (depth > 6) return [];

  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error(`Could not read ${dir}:`, error.message);
    }
    return [];
  }

  const lockFiles = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      lockFiles.push(...await findChromeLockFiles(fullPath, depth + 1));
      continue;
    }

    if (["SingletonLock", "SingletonSocket", "SingletonCookie"].includes(entry.name)) {
      lockFiles.push(fullPath);
    }
  }

  return lockFiles;
}

async function clearChromeLockFiles() {
  const lockFiles = await findChromeLockFiles(sessionPath);

  for (const lockFile of lockFiles) {
    await rm(lockFile, { force: true });
  }

  console.log("Chrome profile lock cleanup:", JSON.stringify({
    removed: lockFiles.length,
    files: lockFiles
  }));

  return lockFiles;
}

async function logWhatsAppDiagnostics() {
  if (whatsappReady) return;

  const secondsSinceEvent = Math.round((Date.now() - lastWhatsAppEventAt) / 1000);
  let browserState = "unavailable";

  try {
    browserState = await whatsapp.getState();
  } catch (error) {
    browserState = `getState failed: ${error.message}`;
  }

  console.log("WhatsApp diagnostic:", JSON.stringify({
    whatsappState,
    browserState,
    secondsSinceLastEvent: secondsSinceEvent,
    sessionPath
  }));

  if (secondsSinceEvent * 1000 >= readyWarnMs) {
    console.error(
      "WhatsApp is still not ready. If it stays here, the saved session may be stale. " +
      "Run /logout, restart, then open /qr for a fresh QR."
    );
  }
}

whatsapp.on("qr", async qr => {
  whatsappReady = false;
  markWhatsAppEvent("qr");
  lastQrDataUrl = "";
  lastQrAt = new Date().toISOString();
  console.log("WhatsApp QR ready. Open /qr in your browser.");

  try {
    lastQrDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 8 });
  } catch (error) {
    console.error("Failed to render QR web page image:", error);
  }
});

whatsapp.on("loading_screen", (percent, message) => {
  markWhatsAppEvent("loading");
  console.log(`WhatsApp loading ${percent}%: ${message}`);
});

whatsapp.on("authenticated", () => {
  markWhatsAppEvent("authenticated");
  console.log("WhatsApp authenticated. Waiting for ready...");
});

whatsapp.on("ready", () => {
  whatsappReady = true;
  markWhatsAppEvent("ready");
  lastQrDataUrl = "";
  console.log("WhatsApp client is ready.");
});

whatsapp.on("auth_failure", message => {
  whatsappReady = false;
  markWhatsAppEvent("auth_failure");
  console.error("WhatsApp auth failed:", message);
});

whatsapp.on("disconnected", reason => {
  whatsappReady = false;
  markWhatsAppEvent("disconnected");
  console.error("WhatsApp disconnected:", reason);
});

whatsapp.on("change_state", state => {
  markWhatsAppEvent(state);
  console.log("WhatsApp state changed:", state);
});

whatsapp.on("error", error => {
  markWhatsAppEvent("error");
  console.error("WhatsApp client error:", error);
});

async function researchFundingNews() {
  const today = new Date().toISOString().slice(0, 10);

  const response = await openai.responses.create({
    model: CONFIG.openaiModel,
    tools: [{ type: "web_search_preview" }],
    input: `
You are a job-search funding research agent for a software engineer.

Goal:
Find ${CONFIG.minCompanies}-${CONFIG.maxCompanies} recently funded startups
that are likely to hire AI engineers, backend engineers, full-stack engineers,
agentic AI engineers, or LLM application engineers.

Candidate profile:
- 1.5+ years software engineering experience at Pine Labs.
- Built production AI evaluation platform with LangChain, OpenAI API,
  PostgreSQL, queues, scheduled jobs, cost controls, and reporting.
- Backend/full-stack experience with Python, FastAPI, gRPC, TypeScript,
  React, Next.js, Electron, PostgreSQL, Redis, Docker.
- Strong LLM systems experience: RAG, LangGraph, multi-agent systems,
  OpenAI API, LLM evaluation, autonomous coding agents, observability.
- India-based. Prefer Bengaluru, India remote, or India-friendly teams.

Search for:
- India AI startup funding today
- India SaaS startup raised seed funding
- India startup raised pre-seed AI funding
- India startup raised Series A AI funding
- AI agent startup raised funding
- developer tools startup raised funding
- full-stack engineering hiring startup funding
- LLM startup raised seed funding
- B2B SaaS startup raised funding India
- fintech AI startup raised funding India
- developer tools funding announced
- enterprise AI startup funding
- workflow automation startup raised funding
- recently funded startups hiring engineers India

Prefer company blogs, investor blogs, TechCrunch, Crunchbase News, FinSMEs,
BusinessWire, PR Newswire, GlobeNewswire, Inc42, YourStory, Entrackr,
VCCircle, and EU-Startups.

Rules:
- Include only companies that announced funding recently.
- Prefer announcements from the last 7 days. If there are enough results from
  the last 24 hours, use only those.
- Return at least ${CONFIG.minCompanies} companies. If fewer than
  ${CONFIG.minCompanies} strong matches are available from the last 7 days,
  expand to the last 30 days.
- Search broadly across multiple sources before finalizing.
- Prefer India-based companies first, then global remote-friendly startups.
- Prefer small and mid-size startups, roughly pre-seed to Series B.
- Prefer teams likely to be hiring hands-on engineers after funding.
- Prefer AI, LLM apps, agents, developer tools, B2B SaaS, fintech infra,
  enterprise software, data/analytics, workflow automation, and full-stack
  product engineering companies.
- Exclude huge companies and labs that are unlikely outreach targets, such as
  Anthropic, OpenAI, Google, Meta, Microsoft, Amazon, Apple, NVIDIA, xAI, Mistral,
  Perplexity, and similar late-stage giants.
- Exclude biotech, pharma, healthcare drug discovery, climate hardware, EV,
  manufacturing, real estate, food, fashion, crypto tokens, lending-only NBFCs,
  fund launches, and old articles unless there is a clear AI/software hiring fit.
- Keep the final message very short.
- Return WhatsApp-ready text only.
- No markdown tables.
- Do not include sectors, locations, reasoning, likely roles, outreach angles,
  descriptions, or extra commentary.

Output format:

Funded Companies To Apply To - ${today}

1. Company - Round/Amount - VC/investor names

Return ${CONFIG.minCompanies}-${CONFIG.maxCompanies} companies.
`
  });

  return response.output_text;
}

async function sendWhatsAppMessage(text) {
  if (!whatsappReady) {
    throw new Error("WhatsApp is not ready. Scan the QR first.");
  }

  if (!targetNumber || targetNumber.includes("X") || targetNumber.includes("+")) {
    throw new Error("Set TARGET_NUMBER without +, spaces, or placeholders. Example: 918917200633");
  }

  await whatsapp.sendMessage(`${targetNumber}@c.us`, text.slice(0, 3500));
}

async function runAgent() {
  if (agentRunning) {
    throw new Error("Agent is already running.");
  }

  if (!whatsappReady) {
    throw new Error("WhatsApp is not ready. Open /qr and scan first.");
  }

  agentRunning = true;
  console.log("Running funded-company research agent...");

  try {
    const report = await researchFundingNews();
    await sendWhatsAppMessage(report);
    console.log("Research report sent.");
    return { ok: true };
  } catch (error) {
    console.error("Agent failed:", error);
    return { ok: false, error: error.message };
  } finally {
    agentRunning = false;
  }
}

function isChromeProfileLockError(error) {
  return String(error?.message || error).includes("profile appears to be in use") ||
    String(error?.message || error).includes("SingletonLock");
}

function isAuthorized(req, url) {
  if (!manualRunToken) return true;
  const token = url.searchParams.get("token") || req.headers["x-run-token"];
  return token === manualRunToken;
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function sendQrPage(res, url) {
  const token = url.searchParams.get("token");
  const runUrl = manualRunToken && token ? `/run?token=${encodeURIComponent(token)}` : "/run";
  const content = whatsappReady
    ? `
      <h1>WhatsApp is ready</h1>
      <p>The bot is logged in.</p>
      <a href="${runUrl}">Run research now</a>
    `
    : lastQrDataUrl
      ? `
        <h1>Scan WhatsApp QR</h1>
        <p>WhatsApp -> Linked devices -> Link a device</p>
        <img src="${lastQrDataUrl}" alt="WhatsApp login QR" />
        <p class="muted">Generated at ${lastQrAt}. This page refreshes automatically.</p>
      `
      : `
        <h1>Waiting for QR</h1>
        <p>No QR has been generated yet. Keep this page open.</p>
        <p class="muted">Current state: ${whatsappState}</p>
      `;

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html>
<html>
  <head>
    <title>WhatsApp QR</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="5" />
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f7f7f4;
        color: #151515;
      }
      main {
        width: min(92vw, 460px);
        text-align: center;
      }
      h1 {
        margin: 0 0 12px;
        font-size: 28px;
      }
      p {
        margin: 8px 0;
        font-size: 15px;
      }
      img {
        width: min(82vw, 340px);
        height: auto;
        margin: 18px 0;
        background: white;
        border: 1px solid #ddd;
      }
      a {
        display: inline-block;
        margin-top: 12px;
        color: #0b5cad;
      }
      .muted {
        color: #666;
        font-size: 13px;
      }
    </style>
  </head>
  <body>
    <main>${content}</main>
  </body>
</html>`);
}

function startHealthServer() {
  const port = process.env.PORT || 3000;

  http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/qr") {
      if (!isAuthorized(req, url)) {
        sendJson(res, 401, { ok: false, error: "Invalid token." });
        return;
      }

      sendQrPage(res, url);
      return;
    }

    if (url.pathname === "/run") {
      if (!isAuthorized(req, url)) {
        sendJson(res, 401, { ok: false, error: "Invalid token." });
        return;
      }

      const result = await runAgent();
      sendJson(res, result.ok ? 200 : 500, result);
      return;
    }

    if (url.pathname === "/logout") {
      if (!isAuthorized(req, url)) {
        sendJson(res, 401, { ok: false, error: "Invalid token." });
        return;
      }

      await whatsapp.logout();
      sendJson(res, 200, { ok: true, message: "Logged out. Restart to get a fresh QR." });
      return;
    }

    if (url.pathname === "/clear-locks") {
      if (!isAuthorized(req, url)) {
        sendJson(res, 401, { ok: false, error: "Invalid token." });
        return;
      }

      const removed = await clearChromeLockFiles();
      sendJson(res, 200, {
        ok: true,
        removed: removed.length,
        message: "Restart the Railway service after clearing locks."
      });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      whatsappReady,
      whatsappState,
      agentRunning,
      targetConfigured: Boolean(targetNumber && !targetNumber.includes("X") && !targetNumber.includes("+")),
      qrAvailable: Boolean(lastQrDataUrl),
      qrUrl: manualRunToken ? "/qr?token=YOUR_TOKEN" : "/qr",
      runUrl: manualRunToken ? "/run?token=YOUR_TOKEN" : "/run",
      clearLocksUrl: manualRunToken ? "/clear-locks?token=YOUR_TOKEN" : "/clear-locks",
      time: new Date().toISOString()
    });
  }).listen(port, () => {
    console.log(`Health server listening on ${port}`);
    console.log(`QR page: ${manualRunToken ? "/qr?token=YOUR_TOKEN" : "/qr"}`);
  });
}

process.on("unhandledRejection", error => {
  console.error("Unhandled promise rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("Uncaught exception:", error);
});

logStartupDiagnostics();

if (clearChromeLocksOnStart) {
  if (persistWhatsAppSession) {
    await clearChromeLockFiles();
  } else {
    console.log("Skipping Chrome lock cleanup because PERSIST_WHATSAPP_SESSION is false.");
  }
}

whatsapp.initialize().catch(error => {
  markWhatsAppEvent("initialize_failed");
  console.error("WhatsApp initialize failed:", error);

  if (isChromeProfileLockError(error)) {
    console.error(
      "Chromium profile is locked. Make sure Railway has only one active instance. " +
      "Then set CLEAR_CHROME_LOCKS=true for one redeploy, or call /clear-locks and restart."
    );
  }
});

setInterval(logWhatsAppDiagnostics, diagnosticIntervalMs).unref();

cron.schedule(CONFIG.cron, runAgent, {
  timezone: CONFIG.timezone
});

startHealthServer();
