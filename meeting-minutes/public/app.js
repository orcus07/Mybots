(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = "meeting-archive";

  // ── 보관함 데이터 관리 ──────────────────────────────────────────────────

  function loadArchive() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
    catch { return []; }
  }

  function saveToArchive(entry) {
    const list = loadArchive();
    list.unshift(entry);
    if (list.length > 100) list.length = 100;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  function deleteFromArchive(id) {
    const list = loadArchive().filter((e) => e.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  // ── 날짜 포맷 ───────────────────────────────────────────────────────────

  function formatDate(iso) {
    return new Date(iso).toLocaleString("ko-KR", {
      year: "numeric", month: "long", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  // ── 뷰 전환 ─────────────────────────────────────────────────────────────

  function showMain() {
    $("main-view").classList.remove("hidden");
    $("archive-view").classList.add("hidden");
  }

  function showArchive() {
    $("main-view").classList.add("hidden");
    $("archive-view").classList.remove("hidden");
    renderArchive();
  }

  $("archive-nav-btn").addEventListener("click", showArchive);
  $("back-btn").addEventListener("click", showMain);

  // ── 보관함 렌더링 ───────────────────────────────────────────────────────

  function renderArchive() {
    const list = loadArchive();
    const container = $("archive-list");
    const empty = $("archive-empty");
    const count = $("archive-count");

    container.innerHTML = "";
    count.textContent = list.length ? `${list.length}개` : "";

    if (!list.length) {
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");

    list.forEach((entry) => {
      const card = document.createElement("div");
      card.className = "archive-card";
      card.dataset.id = entry.id;

      const preview = (entry.summary || "")
        .split("\n").find((l) => l.trim() && !l.startsWith("#"))?.replace(/^[-*•]\s*/, "").trim() || "내용 없음";

      const contextBadge = entry.context
        ? `<span class="context-badge" title="${escapeHtml(entry.context)}">🏷 ${escapeHtml(entry.context.slice(0, 40))}${entry.context.length > 40 ? "…" : ""}</span>`
        : "";

      card.innerHTML = `
        <div class="archive-card-header">
          <div class="archive-meta">
            <span class="archive-date">${formatDate(entry.savedAt)}</span>
            <span class="archive-filename">${escapeHtml(entry.filename || "")}</span>
            ${contextBadge}
          </div>
          <div class="archive-actions">
            <button class="btn-expand" aria-expanded="false">보기</button>
            <button class="btn-delete" title="삭제">✕</button>
          </div>
        </div>
        <p class="archive-preview">${escapeHtml(preview)}</p>
        <div class="archive-body hidden">
          <div class="archive-section">
            <div class="archive-section-header">
              <h3>주요 내용</h3>
              <button class="copy-btn" data-raw="${encodeURIComponent(entry.summary || "")}">복사</button>
            </div>
            <div class="markdown-body">${marked.parse(entry.summary || "")}</div>
          </div>
          <div class="archive-section">
            <div class="archive-section-header">
              <h3>상세 회의록</h3>
              <button class="copy-btn" data-raw="${encodeURIComponent(entry.detailedNotes || "")}">복사</button>
            </div>
            <div class="markdown-body">${marked.parse(entry.detailedNotes || "")}</div>
          </div>
          <div class="archive-section transcript-block">
            <div class="archive-section-header">
              <h3>받아쓰기 원문</h3>
              <button class="copy-btn" data-raw="${encodeURIComponent(entry.transcript || "")}">복사</button>
            </div>
            <pre class="transcript-pre">${escapeHtml(entry.transcript || "")}</pre>
          </div>
        </div>
      `;

      card.querySelector(".btn-expand").addEventListener("click", function () {
        const body = card.querySelector(".archive-body");
        const expanded = this.getAttribute("aria-expanded") === "true";
        body.classList.toggle("hidden", expanded);
        this.textContent = expanded ? "보기" : "접기";
        this.setAttribute("aria-expanded", String(!expanded));
      });

      card.querySelector(".btn-delete").addEventListener("click", () => {
        if (!confirm("이 회의록을 삭제할까요?")) return;
        deleteFromArchive(entry.id);
        card.remove();
        const remaining = loadArchive();
        count.textContent = remaining.length ? `${remaining.length}개` : "";
        if (!remaining.length) empty.classList.remove("hidden");
      });

      container.appendChild(card);
    });
  }

  // ── 복사 버튼 (보관함 + 메인 공용) ─────────────────────────────────────

  document.addEventListener("click", (e) => {
    if (!e.target.classList.contains("copy-btn")) return;

    let text;
    if (e.target.dataset.raw) {
      text = decodeURIComponent(e.target.dataset.raw);
    } else if (e.target.dataset.target) {
      const el = $(e.target.dataset.target);
      text = el.innerText || el.textContent;
    } else return;

    navigator.clipboard.writeText(text).then(() => {
      const orig = e.target.textContent;
      e.target.textContent = "복사됨 ✓";
      setTimeout(() => (e.target.textContent = orig), 1500);
    });
  });

  // ── 업로드 + 처리 ───────────────────────────────────────────────────────

  fetch("/api/health")
    .then((r) => r.json())
    .then((h) => {
      const missing = [];
      if (!h.anthropic) missing.push("ANTHROPIC_API_KEY");
      if (!h.openai)    missing.push("OPENAI_API_KEY");
      if (missing.length) {
        const w = $("key-warning");
        w.textContent = `⚠️ ${missing.join(", ")} 가 설정되지 않았습니다. .env 파일을 확인해주세요.`;
        w.classList.remove("hidden");
      }
    })
    .catch(() => {});

  let currentFilename = "";
  let currentContext  = "";

  $("file-input").addEventListener("change", (e) => {
    currentFilename = e.target.files[0]?.name || "";
  });

  $("run-btn").addEventListener("click", async () => {
    const file = $("file-input").files[0];
    if (!file) return alert("파일을 선택해주세요.");

    currentContext = ($("context-input")?.value || "").trim();

    const btn    = $("run-btn");
    const status = $("status");
    btn.disabled = true;
    $("result").classList.add("hidden");
    status.textContent = "";

    // ── 진행 로그 초기화 ──────────────────────────────────────────────────
    let logStart = Date.now();
    let lastMsg  = "";
    const logEl  = $("progress-log");
    logEl.innerHTML = "";
    logEl.classList.remove("hidden");

    function logStep(msg, icon = "") {
      if (msg === lastMsg) return;
      lastMsg = msg;
      const t  = ((Date.now() - logStart) / 1000).toFixed(1);
      const li = document.createElement("li");
      li.textContent = `+${t}s  ${icon}${msg}`;
      logEl.appendChild(li);
      logEl.scrollTop = logEl.scrollHeight;
      status.textContent = msg;
    }

    logStep("업로드 중…");

    let pollInterval = null;

    function stopPolling() {
      if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
      btn.disabled = false;
    }

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("context", currentContext);

      const uploadRes = await fetch("/api/upload", { method: "POST", body: fd });
      if (!uploadRes.ok) {
        const data = await uploadRes.json().catch(() => ({}));
        throw new Error(data.error || `서버 오류 ${uploadRes.status}`);
      }
      const { jobId } = await uploadRes.json();
      logStep("처리 시작…");

      pollInterval = setInterval(async () => {
        try {
          const res = await fetch(`/api/status/${jobId}`);
          if (res.status === 404) {
            stopPolling();
            logStep("❌ 서버가 재시작됐습니다. 파일을 다시 업로드해주세요.");
            alert("서버가 재시작되어 작업이 초기화됐습니다. 파일을 다시 업로드해주세요.");
            return;
          }
          if (!res.ok) return;
          const job = await res.json();

          if (job.status === "processing") {
            logStep(job.message || "처리 중…");
          } else if (job.status === "done") {
            stopPolling();
            logStep("완료 ✓", "🎉 ");
            status.textContent = "완료 ✓";
            showResult(job);
          } else if (job.status === "error") {
            stopPolling();
            logStep("❌ " + (job.error || "처리 중 오류가 발생했습니다."));
            status.textContent = "";
            alert(job.error || "처리 중 오류가 발생했습니다.");
          }
        } catch (_e) {
          // 네트워크 순단 무시
        }
      }, 3000);

    } catch (err) {
      stopPolling();
      logStep("❌ " + (err.message || "처리 중 오류가 발생했습니다."));
      status.textContent = "";
      alert(err.message || "처리 중 오류가 발생했습니다.");
    }
  });

  function showResult({ transcript, summary, detailedNotes }) {
    $("summary-content").innerHTML      = marked.parse(summary       || "");
    $("notes-content").innerHTML        = marked.parse(detailedNotes || "");
    $("transcript-content").textContent = transcript || "";
    $("result").classList.remove("hidden");
    $("result").scrollIntoView({ behavior: "smooth" });

    saveToArchive({
      id: crypto.randomUUID(),
      savedAt: new Date().toISOString(),
      filename: currentFilename,
      context: currentContext,
      summary,
      detailedNotes,
      transcript,
    });
    showToast();
  }

  function showToast() {
    const toast = $("save-toast");
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 2500);
  }

  function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
})();
