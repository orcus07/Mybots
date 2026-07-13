# Mybots 프로젝트 요약

**작성일**: 2026-05-20  
**저장소**: https://github.com/orcus07/Mybots  
**배포 URL**: https://orcus07.github.io/Mybots/  
**개발 브랜치**: `claude/github-project-setup-IVB6h`  
**배포 브랜치**: `gh-pages`

---

## 프로젝트 목적

AI 인프라 칩 아키텍처를 **실제 공식 사진과 인터랙티브 HTML**로 시각화하는 페이지 제작.  
CSP(AWS/GCP/Azure/Oracle) 칩 계층 구조 → NVIDIA Vera Rubin 실물 하드웨어 사진 기반 아키텍처로 확장 중.

---

## 파일 구성

```
/home/user/Mybots/
├── csp_chip_arch.json          # CSP 칩 아키텍처 리서치 데이터
├── csp_chip_arch.html          # 인터랙티브 CSP 계층도 (다크모드)
├── nvidia_vera_rubin.html      # NVIDIA Vera Rubin 아키텍처 (라이트모드, 실사진)
└── images/
    ├── rack.jpg                # NVIDIA 랙 실물 사진 + 트레이 줌인 (1920×1080)
    ├── slide.jpg               # NVL144 공식 슬라이드 (랙+Vera/Rubin 다이샷, 2000×1125)
    └── superchip.jpg           # Vera Rubin Superchip 보드 사진 + 레이블 (960×608)
```

---

## 완료된 작업 (커밋 순서)

### 1. CSP 칩 아키텍처 리서치 (`csp_chip_arch.json`)
- **내용**: AWS, GCP, Azure, Oracle 4개 CSP의 칩 아키텍처를 계층별(Server → Rack → Cluster → Region) JSON으로 정리
- **데이터 항목**: 칩명, 세대, 스펙(코어수/메모리/네트워크), 상용 출시일, 기술 특징

### 2. 인터랙티브 CSP 계층도 (`csp_chip_arch.html`)
- **기술**: 순수 HTML/CSS/JS, 외부 라이브러리 없음
- **UI**: 탭으로 CSP 선택 → 카드 클릭으로 계층 드릴다운 (Server → Rack → Cluster → Region)
- **특징**: 다크모드, 모바일 대응, 각 레벨 스펙 상세 표시

### 3. NVIDIA Vera Rubin SVG 다이어그램 (초기 버전, 이후 교체)
- SVG 기반 다이어그램으로 제작 → 사용자가 "실제 NVIDIA 공식 사진을 써야 한다"고 피드백

### 4. NVL144 랙 구성 수정
- 초기 오류: 8 트레이 × 4 Superchip = 32 Superchip (틀림)
- 수정: **18 Compute Trays × 2 Superchip = 36 Superchip = 72 GPU 패키지 = 144 GPU Dies** (NVL144 이름의 유래)

### 5. NVIDIA Vera Rubin 실사진 아키텍처 페이지 (현재 버전)
**핵심 문제**: 네트워크 레벨 차단으로 외부 이미지 다운로드 불가  
**해결 방법**: 사용자가 채팅에 업로드한 이미지가 JSONL 파일에 base64로 저장됨을 발견, Python으로 추출

**이미지 추출 방법**:
```python
# /root/.claude/projects/-home-user-Mybots/*.jsonl 에서
# {"type":"image","source":{"type":"base64","data":"..."}} 블록 파싱 → base64 디코딩
```

**HTML 구성 (4단계 계층)**:
```
[RACK] ──→ [COMPUTE TRAY] ──→ [SUPERCHIP] ──→ [CHIP DIE]
 Col 1          Col 2            Col 3           Col 4
slide.jpg      rack.jpg       superchip.jpg    slide.jpg
(왼쪽 크롭)   (오른쪽 크롭)  (왼쪽 크롭)     (transform 줌)
```

**CSS 기법**:
- `object-fit: cover` + `object-position` → 같은 이미지에서 다른 영역 크롭
- `transform: scale(7); transform-origin: 74% 26%` → CSS 줌으로 Vera/Rubin 다이샷 확대
- `overflow: hidden` 컨테이너로 클리핑

**페이지 구조**:
- 상단: NVIDIA 로고 + 제목 + 시스템 탭 (NVL144 / NVL72 / GB300 NVL72)
- 중앙: 4열 실사진 아키텍처 (화살표 연결, 각 열 컴포넌트 레이블)
- 하단: 통계 바 (3.6EF FP4 / 75TB 메모리 / 260TB/s NVLink6 / 144 GPU Dies 등)
- 라이트모드, 화이트 배경, PPT 호환

---

## 배포 구조

```
gh-pages 브랜치
├── index.html          # 메인 허브 (CSP 다이어그램 + NVIDIA 버튼)
├── nvidia.html         # nvidia_vera_rubin.html 의 gh-pages 복사본
└── images/
    ├── rack.jpg
    ├── slide.jpg
    └── superchip.jpg
```

**접근 URL**:
- 메인: https://orcus07.github.io/Mybots/
- NVIDIA 아키텍처: https://orcus07.github.io/Mybots/nvidia.html

---

## 커밋 히스토리

| 커밋 | 내용 |
|------|------|
| `3cb3c1b` | CSP 칩 아키텍처 리서치 JSON 추가 |
| `f4e8066` | 인터랙티브 CSP 계층도 HTML 추가 |
| `ddab325` | gh-pages 첫 배포 |
| `0e6a7b7` | NVIDIA Vera Rubin SVG 다이어그램 추가 |
| `3dbee69` | NVL144 랙 구성 오류 수정 + 공식 키노트 탭 추가 |
| `5aeaf0b` | gh-pages nvidia.html 업데이트 |
| `568e595` | NVIDIA 실사진 기반 아키텍처 페이지로 전면 교체 |
| `4aa6f37` | gh-pages 실사진 버전 배포 |

---

## 다음 단계 (미완료)

- [ ] AWS, GCP, Azure, Oracle 각각에 동일한 "실사진 + 계층 드릴다운" 레이아웃 적용
- [ ] NVL72, GB300 NVL72 탭 콘텐츠 채우기
- [ ] 모바일 반응형 추가 개선
- [ ] 각 CSP 아키텍처 이미지 확보 및 추가

---

## 기술적 특이사항

1. **네트워크 차단**: 서버에서 nvidia.com, tomshardware 등 모든 외부 도메인 접근 불가 (데이터센터 IP 레벨 차단). curl/WebFetch 모두 403.
2. **이미지 소스**: 사용자가 채팅에 업로드한 이미지 → Claude Code JSONL 파일(`/root/.claude/projects/.../*.jsonl`) 에 base64로 저장됨 → Python으로 추출.
3. **CSS 줌 기법**: `transform: scale()` + `transform-origin` + `overflow: hidden` 조합으로 외부 JS 없이 이미지 특정 영역 줌인.
