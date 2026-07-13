# 형제 레포 벤치마크: Mybots vs sv-explorer / PRIMITIVE_WEB / IR-Analysis

- **작성일**: 2026-07-13
- **비교 대상**: `orcus07/sv-explorer`, `orcus07/PRIMITIVE_WEB`, `orcus07/IR-Analysis` (각 `--depth 1` 시점 스냅숏)
- **판정 기준**: "1인 운영 소형 웹앱 규모에 맞는가". 더 정교하다는 이유만으로는 채택하지 않는다.
- **판정 구분**: ✅ 채택 / ⏸ 보류 / ❌ 부적합

---

## 0. 현재 레포(Mybots) 요약

Mybots는 성격이 다른 두 프로젝트가 한 저장소에 동거한다. 하나는 AI 인프라 칩 아키텍처를 시각화한 정적 HTML 페이지들(`csp_chip_arch.html`, `nvidia_vera_rubin.html`, `images/`)로 `gh-pages` 브랜치로 GitHub Pages에 배포한다(`project_summary.md`). 다른 하나는 `meeting-minutes/` 하위의 Node.js(Express) 웹앱으로, 녹음 파일을 올리면 OpenAI Whisper로 받아쓰고 Claude(Haiku 리서치 → Opus 작성 2단계)로 한국어 회의록을 만들어 브라우저 localStorage 보관함에 저장한다. 회의록 앱은 Render(무료 플랜)에 `render.yaml` Blueprint로 배포하며, 서버 소스는 3파일 약 720 LOC 규모다(`meeting-minutes/src/server.js`, `src/lib/transcribe.js`, `src/lib/summarize.js`). 루트에 README는 없고 `project_summary.md`가 인수인계 문서 역할을 한다.

## 형제 레포 한 줄 소개

| 레포 | 무엇을 하나 | 스택 | 규모 |
|---|---|---|---|
| **sv-explorer** | 유튜브 자막 증류 리더. 서버는 자막 수집만, Claude 호출은 브라우저가 직접 수행 | Node/Express + 바닐라 JS | 소스 ~3,400 LOC |
| **PRIMITIVE_WEB** | 영문 아티클/트윗/PDF 링크 → 한글 증류 리더 (3중 수집 전략) | Node/Express + 바닐라 JS | 소스 ~1,900 LOC |
| **IR-Analysis** | 회사 실적/어닝콜을 웹검색 도구로 수집·분석해 md 보고서 생성하는 CLI 파이프라인 | Python 3.11+ | 소스 ~780 LOC |

---

## ① 프로젝트 구조·모듈화

**최우수: IR-Analysis** — 로직(`ir_analysis/`) / 설정(`config/config.yaml`, `config/personas/*.yaml`, `config/style_guide.md`) / 렌더(`render/`) / 산출물(`analyses/`) / 배포 뷰어(`docs/`)를 디렉터리로 분리했다. 특히 프롬프트·문체 규칙·페르소나를 코드 밖 설정 파일로 빼서 코드 수정 없이 바꿀 수 있다.

**현재 레포**: 회의록 앱 자체는 3계층 분리(`src/server.js` 라우팅 / `src/lib/*` 도메인 로직 / `public/` 프런트)가 깔끔해서 PRIMITIVE_WEB(`src/server.js` + `src/lib/{fetchArticle,distill}.js`)과 같은 수준이다. 문제는 앱 계층이 아니라 저장소 계층이다. (a) 정적 시각화 프로젝트와 웹앱이 한 레포에 섞여 있고, (b) 문체 원칙·프롬프트가 `meeting-minutes/src/lib/summarize.js`의 `SYSTEM` 상수에 하드코딩돼 있다.

**차이의 원인**: Mybots는 원래 정적 페이지 레포였는데 배포 사고(PRIMITIVE_WEB 브랜치를 두 세션이 서로 force push로 덮은 사건) 이후 회의록 앱이 급히 이주해 왔다. 계획된 구조가 아니라 사고 수습의 결과다.

**판정**:
- 프롬프트·문체 규칙 외부 파일화(IR-Analysis `config/style_guide.md` 패턴): ✅ 채택. 파일 하나 읽어 문자열에 붙이는 코드 몇 줄이면 되고, 문체 규칙을 고칠 때마다 JS를 건드리지 않아도 된다.
- 저장소 분리(회의록 앱 전용 레포): ⏸ 보류. 이상적이지만 Render 서비스 재연결을 또 해야 하고, 지금 `rootDir: meeting-minutes`(`meeting-minutes/render.yaml`)로 격리가 이미 동작한다. 실제 충돌이 생기면 그때 분리한다.

## ② 에러 핸들링·로깅

**최우수: PRIMITIVE_WEB** — 재시도에 규율이 있다. `src/lib/distill.js`의 `isTransient()`가 408/429/5xx·네트워크류 메시지만 재시도 대상으로 판별하고, 결정적 실패(출력 잘림 `max_tokens`, 초과 크기 PDF)는 `err.noRetry` 플래그로 재시도를 즉시 차단해 비싼 출력 토큰 낭비를 막는다. 사용자향 오류는 전부 한국어로, 다음 행동까지 안내한다. 공개 URL 비용 남용을 막는 `ACCESS_KEY` 게이트도 있다(`src/server.js:68-74`).

**현재 레포**: 작업 단위 try/catch, Claude 호출 3회 재시도(5s/10s 백오프), Whisper 3회 재시도, 오류 타입을 클라이언트까지 노출(`meeting-minutes/src/server.js:139-158`), 진단 엔드포인트 `/api/test-claude`까지 있어 기본기는 좋다. 다만 재시도가 **무조건적**이다 — API 키 오류나 400 같은 결정적 실패도 3회를 다 돌고, 그 사이 사용자는 기다린다. 접근 게이트도 없어 Render URL을 아는 사람은 누구나 Opus 호출 비용을 발생시킬 수 있다.

**차이의 원인**: PRIMITIVE_WEB은 긴 글 처리에서 "잘림 → 재시도 → 또 잘림"으로 토큰을 태운 실전 사고(#19, #20 커밋)를 겪고 고친 것이다. 회의록 앱은 아직 그 사고를 안 겪었을 뿐 같은 구조적 약점이 있다.

**판정**:
- `isTransient` 게이트 + `noRetry` 플래그 이식: ✅ 채택. 함수 하나 + 조건 한 줄 수준의 비용으로 비용 사고를 예방한다.
- `ACCESS_KEY` 접근 게이트 이식: ✅ 채택. 미들웨어 몇 줄이고, 회의록 앱은 Opus를 쓰므로 남용 시 피해가 더 크다.
- sv-explorer의 수제 rate limiter·CSP·SSRF 가드(`src/server.js:26-78,123-127`): ⏸ 보류. 훌륭하지만 회의록 앱은 프록시 엔드포인트가 없어 SSRF 표면이 없고, 게이트만으로 남용 방어가 충분하다.
- 구조적 로거(winston 등) 도입: ❌ 부적합. 네 레포 모두 console 기반으로 운영 중이고, 무료 Render 단일 인스턴스에서 로그 수집 체계 없이 로거만 넣는 건 장식이다.

## ③ 테스트·검증

**최우수: 없음** — 네 레포 전부 테스트가 0이다. sv-explorer·PRIMITIVE_WEB은 `package.json` scripts가 `start`/`dev`뿐이고, IR-Analysis는 CI가 있는데도 lint/test 스텝이 없다. smoke test도 어느 레포에도 없다.

**현재 레포**: 마찬가지로 없음. 과거 인수인계 문서에 "JS 구문 검사 통과, 키 없이 서버 부팅 확인" 같은 수동 검증 기록만 있다.

**차이의 원인**: 전부 1인 운영 + Claude 세션 주도 개발이라, 검증이 "세션이 그때그때 수동으로 확인"에 의존한다. 베낄 모범이 형제 중에 없다.

**판정**:
- 최소 smoke test 1개(`node --check src/**/*.js` + 서버 부팅 후 `/api/health` 200 확인) `npm test`로 등록: ✅ 채택. 10~20줄짜리 셸/JS 스크립트로 "배포했더니 부팅부터 안 됨"류 사고를 막는다. 이번 브랜치 덮어쓰기 사고도 health 응답 필드(`anthropic`/`openai` vs 아티클 리더의 `anthropic`/`locked`)만 봐도 즉시 감지됐다.
- 유닛 테스트 프레임워크(jest/vitest) 도입: ❌ 부적합. 720 LOC, 외부 API가 로직의 대부분인 앱에서 모킹 비용이 효용을 넘는다.

## ④ CI·배포

**최우수: IR-Analysis** — 유일하게 GitHub Actions를 쓴다(`.github/workflows/analyze.yml`). `concurrency` 그룹으로 동시 실행 큐잉, `timeout-minutes: 30`, 푸시 충돌 시 `git pull --rebase` 3회 재시도, 빌드 실패 시 커밋된 `docs/`로 폴백하는 `render.yaml` 등 방어가 촘촘하다. 단, 이 CI는 테스트 게이트가 아니라 분석 파이프라인 실행용이다.

**현재 레포**: CI 없음(`.github/` 부재). 배포는 `meeting-minutes/render.yaml` Blueprint — `rootDir` 지정, `healthCheckPath: /api/health`, API 키 `sync: false`(대시보드 수동 입력), `NODE_VERSION "22"` 고정. 이 구성은 sv-explorer·PRIMITIVE_WEB과 사실상 동일하며 이 규모의 표준형이다. `.env.example`도 있다(IR-Analysis는 이것이 없다).

**차이의 원인**: IR-Analysis만 "실행 자체가 배치 작업"이라 CI가 곧 제품이다. 웹앱 셋은 push-to-deploy로 충분해서 CI를 만들 동기가 없었다.

**판정**:
- 현행 Render Blueprint 유지: ✅ 채택(현상 유지). 이미 형제들과 동급이다.
- GitHub Actions CI 도입: ⏸ 보류. ③의 smoke test를 먼저 만들고, 그걸 push 시 돌리는 10줄짜리 워크플로는 나중에 붙이면 된다. smoke test 없는 CI는 의미가 없으므로 순서상 보류.
- IR-Analysis식 빌드 폴백·rebase 재시도: ❌ 부적합. 웹 서비스 배포에는 해당 상황이 없다.

## ⑤ 의존성 관리

**최우수: sv-explorer** — 직접 의존성 4개로 최소이고, `package-lock.json`(1,099줄)을 커밋해 재현 가능한 빌드를 보장한다. `engines: node >=20` + 배포 시 Node 22 고정도 명시돼 있다.

**현재 레포**: 세 가지가 밀린다. (a) **lockfile이 레포에 없다** — 로컬 작업본에는 `package-lock.json`이 있는데 푸시 목록에서 빠졌다. Render가 `npm install`을 할 때마다 다른 버전이 깔릴 수 있다. (b) **미사용 의존성 2개** — `openai`(Whisper를 native fetch로 직접 호출하므로 SDK 미사용), `youtube-transcript`(유튜브 기능이 이 버전에 없음)가 `meeting-minutes/package.json`에 남아 있다. 소스 전체에 import가 없음을 grep으로 확인했다. (c) IR-Analysis도 락파일이 없고 Python 버전이 render.yaml(3.11.9)과 CI(3.12)에서 불일치하므로 반면교사다.

**차이의 원인**: 회의록 코드가 REST API로 파일을 골라 푸시되는 과정에서 lockfile이 누락됐고, 의존성은 이전 버전(유튜브·PDF 지원) 시절 것이 정리되지 않았다.

**판정**:
- `package-lock.json` 커밋 + `openai`·`youtube-transcript` 제거: ✅ 채택. 각각 파일 추가 1개, 줄 삭제 2줄이다. 이 문서 범위에서는 기록만 하고, 별도 커밋으로 처리한다.

## ⑥ 에이전트 설정 자산

**최우수: 해당자 없음(공식 자산 기준), 유사 자산은 IR-Analysis** — 네 레포 모두 `CLAUDE.md`, `.claude/`(rules/skills/hooks), `.mcp.json`이 없다. 다만 IR-Analysis는 기능적으로 같은 역할을 하는 자산을 만들었다: 문체 규칙을 `config/style_guide.md`로 분리해 런타임에 시스템 프롬프트에 주입하고, 관점을 `config/personas/*.yaml` 스키마로 표준화해 4가지 경로(로컬/자유서술/URL/타 레포 동기화)로 주입받는다.

**현재 레포**: 없음. `project_summary.md`가 인수인계 문서 역할을 하지만 에이전트가 자동으로 읽는 위치가 아니고, 결정적으로 **레포↔브랜치↔배포 매핑 정보가 어디에도 없다**. 이번 사고(두 Claude 세션이 PRIMITIVE_WEB의 같은 브랜치를 서로 force push로 덮어 Render의 회의록 서비스가 아티클 리더로 갈아엎힌 사건)의 근본 원인이 바로 이것이다 — 각 세션이 "이 브랜치가 누구 것이고 어디로 배포되는지"를 알 방법이 없었다.

**차이의 원인**: 네 레포 모두 Claude 세션이 만들었는데도 에이전트 설정 자산이 없는 것은, 세션들이 코드 산출물만 남기고 자기 자신을 위한 컨텍스트는 남기지 않았기 때문이다.

**판정**:
- `CLAUDE.md` 작성: ✅ 채택. 내용은 짧아도 된다 — 이 레포의 두 프로젝트, 브랜치별 역할(`claude/github-project-setup-IVB6h` 개발 / `gh-pages` 정적 배포), Render 서비스와의 연결, "PRIMITIVE_WEB에 force push 금지" 같은 경계 규칙. 이번 사고의 재발 방지책 중 비용이 가장 싸다.
- `.claude/rules·skills·hooks`, `.mcp.json`: ⏸ 보류. 지금 자동화할 반복 작업이 특정되지 않았다. CLAUDE.md를 먼저 만들고 필요가 드러나면 추가한다.

---

## 채택 후보 Top 5 (구현 비용 대비 효과 순)

| 순위 | 항목 | 출처 | 비용 | 효과 |
|---|---|---|---|---|
| 1 | **`package-lock.json` 커밋 + 미사용 의존성(`openai`, `youtube-transcript`) 제거** | sv-explorer의 lockfile 규율 | 5분 | Render 빌드 재현성 확보, 설치 시간·표면적 축소. 현재 레포의 명백한 구멍 |
| 2 | **`CLAUDE.md` 작성 (레포·브랜치·배포 매핑 + 경계 규칙)** | 형제 전부의 공백에서 얻은 교훈 | 30분 | 이번 브랜치 덮어쓰기 사고의 직접적 재발 방지. 모든 후속 세션이 혜택 |
| 3 | **재시도 규율 이식: `isTransient()` + `noRetry`** | PRIMITIVE_WEB `src/lib/distill.js:221-272` | 1시간 | 결정적 오류에 대한 헛 재시도 제거 — Opus 토큰 비용과 사용자 대기시간 동시 절감 |
| 4 | **`ACCESS_KEY` 접근 게이트** | PRIMITIVE_WEB `src/server.js:68-74` | 1시간 | 공개 Render URL로 인한 API 비용 남용 차단. Opus 사용 앱이라 형제보다 절실 |
| 5 | **smoke test + `npm test` 등록 (구문 검사 + 부팅 + `/api/health` 200)** | 형제 전부의 공백 | 1~2시간 | "배포했는데 부팅 실패"·"엉뚱한 앱이 서빙됨"을 배포 전에 감지. 추후 CI의 토대 |

**차순위(보류 중 유망)**: 보관함 localStorage → IndexedDB 이전(sv-explorer가 PR #38에서 완료. 받아쓰기 원문을 통째 저장하는 현 구조는 5MB 한도에 먼저 걸릴 수 있으나, 실사용 데이터로 한도 근접이 확인되면 착수) · 문체 원칙의 `style_guide.md` 외부화(IR-Analysis 패턴, ①에서 채택 판정했으나 효과가 편의성 위주라 Top 5에서는 제외).
