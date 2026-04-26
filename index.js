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
const readyWarnMs = Number(process.env.WHATSAPP_READY_WARN_MS || 90000);
const diagnosticIntervalMs = Number(process.env.WHATSAPP_DIAGNOSTIC_INTERVAL_MS || 30000);

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
let whatsappState = "starting";
let agentRunning = false;
let lastWhatsAppEventAt = Date.now();

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
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
    targetNumber: maskNumber(targetNumber),
    targetNumberHasPlus: Boolean(targetNumber?.includes("+")),
    manualRunProtected: Boolean(manualRunToken),
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
      "Run `curl http://localhost:3000/logout`, stop with Ctrl+C, then run `npm start` again for a fresh QR."
    );
  }
}

whatsapp.on("qr", qr => {
  whatsappReady = false;
  markWhatsAppEvent("qr");
  console.log("\nScan this QR from WhatsApp > Linked devices > Link a device:\n");
  qrcode.generate(qr, { small: true });
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
- Search broadly across multiple sources before finalizing. Do not stop after
  finding only a few companies.
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
- Categorize rounds as pre_seed, seed, series_a, series_b, series_c, growth, debt, grant, or undisclosed.
- Rank by "should I apply/outreach?" priority for this candidate.
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

  if (!targetNumber || targetNumber.includes("X")) {
    throw new Error("Set TARGET_NUMBER or config.targetNumber before sending.");
  }

  await whatsapp.sendMessage(`${targetNumber}@c.us`, text.slice(0, 3500));
}

async function runAgent() {
  if (agentRunning) {
    throw new Error("Agent is already running.");
  }

  if (!whatsappReady) {
    throw new Error("WhatsApp is not ready. Scan the QR first.");
  }

  if (!targetNumber || targetNumber.includes("X") || targetNumber.includes("+")) {
    throw new Error("Set TARGET_NUMBER without +, spaces, or placeholders. Example: 918917200633");
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

    if (url.pathname === "/logout") {
      await whatsapp.logout();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: "Logged out. Restart npm start to get a fresh QR." }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      whatsappReady,
      whatsappState,
      agentRunning,
      targetConfigured: Boolean(targetNumber && !targetNumber.includes("X") && !targetNumber.includes("+")),
      time: new Date().toISOString()
    }));
  }).listen(port, () => {
    console.log(`Health server listening on ${port}`);
  });
}

process.on("unhandledRejection", error => {
  console.error("Unhandled promise rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("Uncaught exception:", error);
});

logStartupDiagnostics();

whatsapp.initialize().catch(error => {
  markWhatsAppEvent("initialize_failed");
  console.error("WhatsApp initialize failed:", error);
});

setInterval(logWhatsAppDiagnostics, diagnosticIntervalMs).unref();

cron.schedule(CONFIG.cron, runAgent, {
  timezone: CONFIG.timezone
});

startHealthServer();
