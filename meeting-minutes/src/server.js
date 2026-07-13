import "dotenv/config";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import express from "express";
import multer from "multer";

import Anthropic from "@anthropic-ai/sdk";
import { transcribeMedia } from "./lib/transcribe.js";
import { writeMeetingNotes } from "./lib/summarize.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const UPLOAD_DIR = path.join(ROOT, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(express.static(path.join(ROOT, "public")));

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 500 * 1024 * 1024 },
});

// 진행 중인 작업 저장 (메모리)
// { status: "processing"|"done"|"error", message, transcript, summary, detailedNotes, error }
const jobs = new Map();

app.get("/api/health", (_req, res) => {
  res.json({
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
  });
});

// Claude API 연결 진단 엔드포인트
app.get("/api/test-claude", async (_req, res) => {
  const out = {};

  // 0. API 키 문자 검사
  const key = process.env.ANTHROPIC_API_KEY || "";
  const badChars = [];
  for (let i = 0; i < key.length; i++) {
    if (key.charCodeAt(i) > 127) {
      badChars.push({ index: i, code: key.charCodeAt(i) });
    }
  }
  out.keyCheck = {
    set: key.length > 0,
    length: key.length,
    preview: key ? key.slice(0, 12) + "..." + key.slice(-4) : "(없음)",
    badChars,
  };

  // 1. node:https로 TCP+TLS 연결 테스트
  out.rawHttps = await new Promise((resolve) => {
    const req = https.get("https://api.anthropic.com/", { timeout: 8000 }, (r) => {
      resolve({ ok: true, httpStatus: r.statusCode });
      r.destroy();
    });
    req.on("error", (e) => resolve({ ok: false, code: e.code, error: e.message }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "timeout" }); });
  });

  // 2. native fetch GET 테스트
  try {
    const fr = await fetch("https://api.anthropic.com/", { signal: AbortSignal.timeout(8000) });
    out.rawFetch = { ok: true, httpStatus: fr.status };
  } catch (e) {
    out.rawFetch = { ok: false, type: e.constructor?.name, error: e.message };
  }

  // 3. native fetch POST 테스트 (SDK 없이 직접 호출)
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const fr = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 10,
          messages: [{ role: "user", content: "Say OK" }],
        }),
        signal: AbortSignal.timeout(30000),
      });
      const txt = await fr.text();
      out.rawPost = { ok: true, httpStatus: fr.status, body: txt.slice(0, 200) };
    } catch (e) {
      out.rawPost = { ok: false, type: e.constructor?.name, error: e.message };
    }
  } else {
    out.rawPost = { ok: false, error: "ANTHROPIC_API_KEY not set" };
  }

  // 4. Anthropic SDK 테스트
  if (!process.env.ANTHROPIC_API_KEY) {
    out.sdk = { ok: false, error: "ANTHROPIC_API_KEY not set" };
    return res.json(out);
  }
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, fetch: (url, init) => fetch(url, init) });
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 10,
      messages: [{ role: "user", content: "Say OK" }],
    });
    out.sdk = { ok: true, response: msg.content[0]?.text };
  } catch (err) {
    out.sdk = { ok: false, type: err.constructor?.name, error: err.message, status: err.status ?? null };
  }

  res.json(out);
});

function cleanup(filePath) {
  if (filePath) fs.rm(filePath, { force: true }, () => {});
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 백그라운드 처리
async function processJob(jobId, filePath, context = "") {
  const update = (message) => jobs.set(jobId, { ...jobs.get(jobId), message });

  try {
    update("받아쓰기 시작…");
    const transcript = await transcribeMedia(filePath, (msg) => update(msg));

    if (!transcript) throw new Error("받아쓰기 결과가 비어 있습니다.");

    // Claude API 호출 — 일시적 오류 시 최대 3회 재시도
    let result;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        result = await writeMeetingNotes(transcript, context, (msg) => update(msg));
        break;
      } catch (err) {
        if (attempt === 3) throw err;
        update(`회의록 작성 재시도 중… (${attempt + 1}/3)`);
        await sleep(5000 * attempt); // 5s, 10s
      }
    }

    const { summary, detailedNotes } = result;
    jobs.set(jobId, { status: "done", transcript, summary, detailedNotes });
  } catch (err) {
    const errType = err.constructor?.name;
    const errMsg = err.message || "처리 중 오류가 발생했습니다.";
    const detail = errType && errType !== "Error" ? `[${errType}] ${errMsg}` : errMsg;
    jobs.set(jobId, { status: "error", error: detail });
  } finally {
    cleanup(filePath);
  }
}

// 1) 파일 업로드 → 즉시 jobId 반환 (연결 바로 끊음)
app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "파일이 없습니다." });

  const context = (req.body?.context || "").slice(0, 500); // 최대 500자
  const jobId = randomUUID();
  jobs.set(jobId, { status: "processing", message: "파일 수신 완료, 처리 시작…" });

  // 백그라운드에서 처리 시작 (await 없이)
  processJob(jobId, req.file.path, context);

  res.json({ jobId });
});

// 2) 상태 폴링 — 3초마다 클라이언트가 여기를 확인
app.get("/api/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "작업을 찾을 수 없습니다." });
  res.json(job);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`http://localhost:${PORT} 에서 실행 중`);
  if (!process.env.ANTHROPIC_API_KEY || !process.env.OPENAI_API_KEY)
    console.warn("⚠️  .env 에 ANTHROPIC_API_KEY / OPENAI_API_KEY 를 설정해주세요.");
});
