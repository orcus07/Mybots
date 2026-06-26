import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";

ffmpeg.setFfmpegPath(ffmpegPath);

const MAX_BYTES = 24 * 1024 * 1024;
const CHUNK_SECONDS = 600;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function apiKey() {
  if (!process.env.OPENAI_API_KEY)
    throw new Error("OPENAI_API_KEY 가 설정되지 않았습니다.");
  return process.env.OPENAI_API_KEY;
}

function probeDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      resolve(data.format?.duration ?? 0);
    });
  });
}

function extractSegment(input, output, start, seconds) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .setStartTime(start)
      .duration(seconds)
      .noVideo()
      .audioChannels(1)
      .audioBitrate("64k")
      .audioCodec("aac")
      .format("mp4")
      .on("end", () => resolve(output))
      .on("error", reject)
      .save(output);
  });
}

// OpenAI SDK의 node-fetch 대신 native fetch로 직접 호출 (Premature close 우회)
async function whisper(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const blob = new Blob([fileBuffer], { type: "audio/mp4" });

  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const fd = new FormData();
    fd.append("file", blob, path.basename(filePath));
    fd.append("model", "whisper-1");
    fd.append("response_format", "text");

    try {
      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey()}` },
        body: fd,
        signal: AbortSignal.timeout(300000), // 5분
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await sleep(4000 * attempt); // 4s, 8s
    }
  }
  throw lastErr;
}

/**
 * 음성/영상 파일을 받아쓰기한 전체 텍스트를 반환.
 * @param {string} filePath
 * @param {(msg: string) => void} [onProgress]
 * @returns {Promise<string>}
 */
export async function transcribeMedia(filePath, onProgress) {
  const { size } = fs.statSync(filePath);

  if (size <= MAX_BYTES) {
    onProgress?.("받아쓰기 중…");
    return (await whisper(filePath)).trim();
  }

  const duration = await probeDuration(filePath);
  const totalChunks = Math.ceil(duration / CHUNK_SECONDS);
  const tmpDir = path.join(os.tmpdir(), `transcribe-${randomUUID()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const parts = [];
  try {
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SECONDS;
      onProgress?.(`받아쓰기 중… (${i + 1}/${totalChunks})`);
      const seg = path.join(tmpDir, `seg-${start}.m4a`);
      await extractSegment(filePath, seg, start, CHUNK_SECONDS);
      const text = await whisper(seg);
      if (text.trim()) parts.push(text.trim());
      fs.rmSync(seg, { force: true });
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return parts.join("\n");
}
