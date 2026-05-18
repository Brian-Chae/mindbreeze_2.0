# MIND BREEZE 2.0 — 종합 서비스 기획

| 항목 | 값 |
|------|-----|
| **현재 버전** | `v1.3.0` |
| **문서 상태** | `Active` *(가능 값: Draft → Review → Active → Deprecated)* |
| **최초 작성** | 2026-05-18 |
| **최종 수정** | 2026-05-18 |
| **문서 소유** | Product / Brian (승인 게이트 §18) |

**참조 문서**

- `docs/MIND_BREEZE_Service_Plan.md` — 서비스 기획서 v1.0 (2026.03)
- `docs/MIND_BREEZE_2.0_기능명세서.md` — F-ID·QA·MVP 매핑 (v1.1.0)
- `docs/AI_STACK_DECISION.md` — AI 벤더·폴백 결정 (v1.0.0)
- `docs/Archives/PRD_MVP1_MVP2.md` — 아카이브 PRD (2026.03)
- `docs/Archives/PRD_User_Mobile_Service.md` — 아카이브 모바일 PRD (2026.03)
- `docs/VARIANT_AI_LOGIN_DESIGN_BRIEF.md` — 디자인 리디자인 브리프 (2026.03.30)
- `design/front-master.pen` — 전체 IA·화면 Pencil 프로토타입
- Paperclip: `Mind-Breeze-2.0-B2B-Commercialization` 프로젝트 브리프

---

## 0. 문서 버전 관리

> 본 섹션은 **기획서 자체**의 변경을 추적한다. 제품 릴리스(MVP1·2·3) 버전과는 별도이다.

### 0.1 버전 번호 규칙 (Semantic Versioning)

형식: **`vMAJOR.MINOR.PATCH`**

| 자릿수 | 올리는 경우 | 예시 |
|:---:|:---:|------|
| **MAJOR** | 서비스 범위·아키텍처·MVP 경계 등 **전략 수준** 변경 | 하이브리드 전략 도입, B2B→B2C 모델 전환 |
| **MINOR** | 섹션 추가·기능 정의·로드맵·IA **내용** 변경 | 알림 채널 정책, 새 MVP 항목 |
| **PATCH** | 오탈자·표현 정리·참조 링크·포맷만 수정 | 문구 다듬기, 날짜 수정 |

### 0.2 수정 시 필수 절차

1. 본문 변경 내용 반영
2. 상단 메타 테이블의 **현재 버전**·**최종 수정** 일자 갱신
3. 아래 **§0.3 변경 이력**에 행 추가 (버전·일자·요약·영향 섹션·작성자)
4. 하위 PRD·서비스 기획서와 **불일치**가 생기면 해당 문서 버전도 별도 갱신

### 0.3 변경 이력 (Changelog)

| 버전 | 일자 | 상태 | 변경 요약 | 영향 섹션 | 작성 |
|------|------|------|----------|----------|------|
| `v1.3.0` | 2026-05-18 | Active | **디자인 시스템 Clinical Garden 전면 반영** (§12 완전 재작성). North Star·컬러·타이포·Breath Circle·Voice&Tone·접근성·토큰 빌드 파이프라인. 구 Pencil 보라색 디자인과 결별 | §12 | — |
| `v1.2.0` | 2026-05-18 | — | **31주 단일 로드맵** 확정(MVP1 17주·MVP2 8주·MVP3 6주). §3A B2B 자격·§3A.5 등급. AI 스택 결정서 연동. 구 20주/14주·Sprint1~3 표기를 MVP1~3로 통합 | §1, §3A, §6~§9, §13~§14, §17 | — |
| `v1.1.0` | 2026-05-18 | — | 하이브리드 3단계(웹→RN 푸시→RN BLE), 알림·BLE 아키텍처 분리 | §1, §2, §5~§8, §13~§17 | — |
| `v1.0.0` | 2026-05-18 | — | 종합 기획서 최초 통합 (Pencil IA·서비스기획·PRD·디자인브리프 단일화) | 전체 | — |

### 0.4 관련 문서 버전 매핑

| 본 문서 버전 | 연동 권장 하위 문서 | 비고 |
|-------------|-------------------|------|
| `v1.2.0` | `MIND_BREEZE_2.0_기능명세서.md` v1.1.0 | F-ID·QA·MVP 매핑은 기능명세서 우선 |
| `v1.2.0` | `AI_STACK_DECISION.md` v1.0.0 | STT·요약·OCR 벤더 |
| `v1.2.0` | `Archives/PRD_User_Mobile_Service.md` | 하이브리드 3단계 개념 참고 |
| `v1.0.0` | `Archives/MIND_BREEZE_Service_Plan.md` | 원본 서비스 기획 |

### 0.5 향후 변경 이력 작성 템플릿

```markdown
| `vX.Y.Z` | YYYY-MM-DD | Active | (한 줄 요약) | §N, §M | (이름) |
```

---

## 1. 서비스 개요

**MIND BREEZE 2.0**은 룩시드랩스의 LINK BAND 뇌파 측정 기술과 AI 분석 엔진을 결합한 **뇌파 기반 심리상담·명상 통합 서비스 플랫폼**이다.

- **비전:** 심리상담사와 명상 지도사의 업무 효율을 AI 기반 자동 기록·요약으로 혁신하고, 선택적 LINK BAND 연동으로 내담자의 상태를 과학적으로 파악할 수 있는 통합 멘탈 케어 플랫폼.
- **서비스 모델:** B2B (상담사/명상 지도사가 고객, 내담자는 최종 사용자)
- **플랫폼:** 웹 우선 (관리자 + 내담자 모바일 웹) → **하이브리드 앱** (React Native 최소 셸, 네이티브 기능만 탑재)
- **출시 로드맵 (확정):** **총 31주** — **MVP1**(17주) → **MVP2**(8주) → **MVP3**(6주). 상세 F-ID 매핑은 `MIND_BREEZE_2.0_기능명세서.md` §6.
- **MVP1:** 웹 SPA + B2B 자격·센터 인증 + 내담자·세션·채팅 + AI 녹음·STT·기록지·리포트 + **상담사 PC Web Bluetooth** + 이메일·인앱 알림
- **MVP2:** RN 앱 셸 + **앱 BLE** + FCM/APNs 푸시 (이메일 폴백)
- **MVP3:** 셀프 트레이닝·케어·AI·통계 고도화
- **하드웨어:** LINK BAND 2.0 — **선택적 사용 (opt-in)**. MVP1=상담센터 PC, MVP2=고객 앱
- **서비스 플로우:** 진단(설문) → 케어(과제 수행) → 리포트(상담 결과) — AI가 전 과정 지원

### 1.1 핵심 차별점

| 구분 | 기존 명상 앱 | MIND BREEZE 2.0 |
|------|------------|-----------------|
| 측정 | 자가 보고 | LINK BAND 실시간 뇌파 측정 |
| 기록 | 수기/메모 | AI 자동 녹음·STT·요약 |
| 피드백 | 일반적 가이드 | 개인화 AI 리포트 + 뇌파 분석 |
| 운영 | 수동 관리 | 통합 예약·내담자·리포트 대시보드 |
| 하드웨어 | 불필요 | LINK BAND 선택적 사용 (미착용 시에도 핵심 기능 제공) |

---

## 2. 설계 철학 (5대 원칙)

| # | 원칙 | 설명 |
|---|------|------|
| 1 | **LINK BAND는 선택이다** | 모든 핵심 기능(예약·기록·AI 요약·리포트)은 LINK BAND 없이도 완전히 동작한다. 뇌파 측정은 부가 가치. |
| 2 | **AI가 기록한다, 사람이 결정한다** | STT·요약·리포트 초안은 AI가 생성하되, 최종 승인·편집은 상담사의 권한. |
| 3 | **데이터 프라이버시는 설계 기반** | 뇌파·상담 데이터는 기본적으로 암호화. 동의 기반 수집. 접근 로그 필수. |
| 4 | **웹 우선, 하이브리드 보강** | MVP1(17주)에 웹·AI·상담센터 BLE·B2B 인증을 묶어 출시. MVP2(8주)에 앱·푸시·앱 BLE만 네이티브 보강. |
| 5 | **B2B SaaS, B2C 경험** | 상담사/기관이 비용을 지불하는 B2B 모델. 내담자는 무료로 초대받아 프리미엄 경험. |

---

## 3. 사용자 유형 및 페르소나

### 3.1 전문가 (상담사 / 명상 지도사)

**역할:** 세션 생성·운영·기록 관리·리포트 발행의 주체

| 유형 | 세션 형태 | LINK BAND 권장도 | 핵심 니즈 |
|------|----------|:---:|------|
| **임상 심리상담사** | 1:1 상담 | 중간 | 내담자 심리 상태 추적, 상담 기록 자동화 |
| **최면 심리상담사** | 1:1 최면 | **높음** | 의식/무의식 전환 구간 모니터링 |
| **명상 지도사** | 그룹 수업 | **높음** | 다수 참여자 동시 상태 파악, 수업 효과 측정 |

### 3.2 클라이언트 (내담자 / 참여자)

**역할:** 세션 참여, 동의 시 LINK BAND 착용, 리포트 확인, 셀프 트레이닝 수행

| 유형 | 참여 형태 | LINK BAND | 핵심 니즈 |
|------|----------|:---:|------|
| **상담 내담자** | 1:1 예약 | 선택 | 개인 리포트, 상담사와의 소통, 셀프 트레이닝 |
| **명상 참여자** | 그룹 수업 | 선택 | 수업 일정 확인, 그룹 리포트, 셀프 명상 |

### 3.3 운영·관리 역할

| 역할 | 설명 |
|------|------|
| **OrgAdmin** | 상담센터 대표 — 소속 상담사 승인·센터 정보 |
| **PlatformAdmin** | 룩시드 운영 — 자격 검토 큐(F11)·사용자 정지 |

---

## 3A. B2B 신뢰성 — 상담센터·상담사 자격 증명

> 기능 상세·QA: `MIND_BREEZE_2.0_기능명세서.md` F2·F3·F11

### 3A.1 목표

상담사·센터의 **자격·사업자 진위**를 증빙 기반으로 검증하고, 미검증 계정의 내담자 매칭을 제한한다.

### 3A.2 가입·온보딩 (MVP1)

- 상담사 Step 3: 소속 형태(기존 센터 / 신규 센터 / 1인) + 증빙 업로드 → F2·F3
- 내담자 Step 4: 상담사 코드 6자리 — 상담사가 **`Verified` 이상**일 때만 매칭 성공

### 3A.3 AI 자동 검증 (F3.5)

업로드 직후 Celery: Gemini Vision OCR → 문서 분류 → (센터) 국세청 사업자 상태 API → 위변조·교차 일관성 → `auto_approve` / `needs_review` / `reject`.  
벤더·폴백: `docs/AI_STACK_DECISION.md`.

### 3A.4 어드민 검토 큐 (F11)

`needs_review` 건을 PlatformAdmin이 승인·반려·추가 자료 요청. 모든 처리는 `VerificationAudit` 기록.

### 3A.5 인증 등급

| 등급 | 조건 (요지) | 내담자 매칭·검색 |
|------|-------------|------------------|
| **Verified+** | 센터 `auto_approve` + 신분증·자격 1종 이상 `auto_approve` + 공공 API 일치 | ✅ 노출 |
| **Verified** | 신분증 `auto_approve` + (자격증·학위·경력) 1종 이상 `auto_approve` 또는 어드민 승인 | ✅ 노출 |
| **Self-Declared** | 증빙 업로드했으나 `needs_review` 대기 또는 일부만 승인 | ❌ 제외 |
| **Unverified** | Step 3 미완료·필수 증빙 없음·`reject` | ❌ 제외 |

등급 변동 시 이메일·인앱 통지. 만료·갱신(F3.4)은 **MVP3**.

### 3A.6 MVP 매핑

| MVP | 자격·센터 범위 |
|-----|----------------|
| **MVP1** | F2·F3·F3.5·F11 전부 (F3.4 제외) |
| **MVP2** | 모바일 증빙 촬영·재제출 (F12.4) |
| **MVP3** | 만료 리마인드·위변조 고도화 (F3.4 등) |

---

## 4. 전체 IA (Information Architecture)

> 출처: `design/front-master.pen` (Pencil 프로토타입)

### 4.1 관리자 웹 — 화면 구성

```
MIND BREEZE 관리자
├── 🏠 Home Dashboard          # 오늘의 예약, 알림, 통계 요약
├── 📅 Schedule                # 일정 관리 (Daily/Weekly/Monthly)
│   ├── 세션 생성/수정/삭제
│   ├── 반복 일정 설정
│   └── 내담자 초대
├── 💬 Chat (Main)             # 상담사-내담자 1:1 채팅
├── 🧘 Care - Main             # 내담자별 케어 과제 관리
│   ├── 과제 처방
│   ├── 수행 현황
│   └── 피드백 작성
├── 👥 Client Management       # 내담자 프로필·이력·태그 관리
├── 🔔 Notification            # 알림 템플릿·발송 이력
├── 📋 Board (Main)            # 공지사항·가이드 게시판
├── 📓 Journal by Client/Date  # 내담자별 세션 저널
└── ⚙️ Settings
    ├── Notification 설정
    ├── Schedule 기본값
    ├── LINK BAND 설정
    ├── Security
    ├── Help
    └── Theme
```

### 4.2 로그인·온보딩 플로우

> 출처: `design/front-master.pen` Node ID 참조

| 화면 | Node ID | 설명 |
|------|---------|------|
| **로그인** | `OAjJw` | 좌측 브랜드 패널 + 우측 로그인 폼 (이메일·비밀번호·소셜) |
| **역할 선택** | `bsILt` | 상담사 vs 내담자 2컬럼 카드 선택 |
| **상담사 가입 Step 1** | `ozyPe` | 기본 정보 (이름·이메일·비밀번호) |
| **상담사 Step 2** | `bf0LE` | 상세 정보 (성별·생년월일·경력·전문분야) |
| **상담사 Step 3** | `n2XTH` | 전문 자격 인증 (자격증 업로드) |
| **상담사 Step 4** | `rC9KZ` | 프로필 완성 (사진·한줄소개) |
| **상담사 프로필 확인** | `WVyGK` | 완성 프로필 + 상담사 코드 발급 |
| **내담자 가입 Step 1** | `yW13N` | 기본 정보 |
| **내담자 Step 2** | `NzIS4` | 상세 정보 (성별·생년월일·불편영역·서비스유형) |
| **내담자 Step 3** | `nZJa5` | 프로필 만들기 |
| **내담자 Step 4** | `igsPv` | 상담사 지정 (6자리 초대 코드 입력, OTP 스타일) |

### 4.3 고객 모바일 — 하단 5탭

```
고객 모바일 (내담자/참여자)
├── 📅 일정     # 내 일정 목록·상세·리마인더
├── 💬 채팅     # 상담사 1:1 채팅·시스템 알림
├── 🧘 케어     # 오늘의 과제·수행·히스토리
├── 📋 게시판   # 공지·가이드 열람
└── ⚙️ 설정     # 프로필·알림(인앱/푸시)·LINK BAND(3단계 앱)·보안
```

---

## 5. 핵심 서비스 플로우

### 5.1 세션 라이프사이클

```
[예정] → [진행중] → [완료] → [리포트 발행]
   ↓         ↓         ↓
[취소]   [일시정지]  [재개]
```

### 5.2 상담사 여정 (Phase 1-3)

**Phase 1 — 세션 준비**
1. 로그인 → 대시보드 (오늘 예약·알림·통계)
2. 새 세션 생성: 유형 선택(임상/최면/명상) → 일정 → 내담자 초대
3. 이전 세션 기록 확인: 기록지·셀프 트레이닝 데이터

**Phase 2 — 세션 진행**
4. 세션 시작: **PC Chrome** LINK BAND 연결 안내(선택) → 음성 녹음 동의
5. 실시간 모니터링: LINK BAND 연결 시 뇌파 대시보드 / 미연결 시 타이머만 (고객 앱 BLE는 **MVP2**)
6. 주요 시점 마커: 특이사항 타임스탬프 태그 + 메모

**Phase 3 — 세션 종료 및 후속**
7. 세션 종료: 녹음 종료 → AI 요약 자동 생성 (수 분 내)
8. 기록지 확인·편집 → 저장
9. 리포트 발행: 내담자용 리포트 확인 → 발송 승인
10. 셀프 트레이닝 처방 (MVP3)

### 5.3 내담자 여정

1. 초대 **이메일/인앱**(MVP1) / **앱 푸시**(MVP2) 수신 → 웹 또는 앱 접속 → 회원가입/로그인
2. 예약 확인 → 세션 참여 → LINK BAND(선택): MVP1은 **상담센터·상담사 PC**, MVP2부터 **고객 앱 BLE**
3. 세션 후 리포트 수신·확인 (§18 승인 후 발송)
4. 셀프 트레이닝 수행 (**MVP3**)

---

## 6. 클라이언트 전달 전략 (MVP1 → MVP2)

> 별도 네이티브 앱 전면 개발 없이, **웹을 제품 본체**로 두고 디바이스 의존 기능만 React Native 최소 셸로 보강한다.  
> 상세: `docs/Archives/PRD_User_Mobile_Service.md` §6 (개념), 본 문서 §13 (일정)

| MVP | 기간 | 범위 | BLE | 알림 |
|:---:|---:|------|-----|------|
| **MVP1** | 17주 | 관리자·내담자 웹 SPA, B2B 인증, AI 기록·리포트 | 상담사 **PC Chrome/Edge** Web Bluetooth(선택) | **이메일** + **인앱** |
| **MVP2** | 8주 | RN WebView 셸, 스토어 배포 | **앱 RN BLE** + PC BLE 유지 | **FCM/APNs 푸시** (이메일 폴백) |
| **MVP3** | 6주 | 케어·트레이닝·AI·통계 고도화 | MVP2 유지 | MVP2 유지 |

**원칙:** UI·비즈니스 로직은 React 웹 코드베이스 단일 유지. RN 셸은 Push 토큰·권한·BLE GATT 등 **브리지 역할만** 담당.

---

## 7. LINK BAND 연동 아키텍처

### 7.1 연결 플로우 (공통 — EEG 수신 후)

```
① 사용자 제스처 → BLE 스캔·페어링
       ↓
② LINK BAND GATT Service UUID 필터링 → EEG Characteristic 구독
       ↓
③ Raw EEG 데이터 WebSocket → 백엔드 전송
       ↓
④ 백엔드 AI 분석 → 결과 WebSocket → 프론트엔드 반환
```

### 7.2 단계별 BLE 구현 경로

| 환경 | MVP1 | MVP2 |
|------|--------|--------|
| 상담사 PC (Chrome/Edge) | **Web Bluetooth API** | 동일 |
| 내담자 Android·iOS | 연결 UI 비활성·앱 안내(MVP2) | **RN BLE 브리지** |
| 내담자 모바일 웹 | MVP1에서 BLE 비활성 | 앱 설치 유도 |

### 7.3 기술 제약

| 항목 | 내용 |
|------|------|
| 웹 BLE 지원 | Chrome, Edge 등 Chromium 기반 (데스크톱·Android Chrome) |
| 웹 BLE 미지원 | Safari, Firefox, **iOS Safari** — 연결 불가 안내 UX |
| 하이브리드 BLE | React Native + 플랫폼 BLE 모듈 (**MVP2**). 웹 UI와 JS 브리지로 EEG 스트림 전달 |
| BLE 버전 | LINK BAND 2.0 GATT (BLE 5.0) |

### 7.4 LINK BAND 착용 여부에 따른 기능 차이

| 기능 | 미착용 (기본) | 착용 (Opt-in) |
|------|:---:|:---:|
| 세션 예약·관리 | ✅ | ✅ |
| 음성 녹음·STT | ✅ | ✅ |
| AI 요약·기록지 | ✅ (텍스트 기반) | ✅ (뇌파 연동) |
| 실시간 뇌파 대시보드 | ❌ | ✅ |
| 뇌파 분석 리포트 | ❌ | ✅ |
| 셀프 트레이닝 | ✅ (가이드만) | ✅ (뇌파 피드백) |

---

## 8. 알림 아키텍처

### 8.1 MVP별 알림 채널

| 이벤트 | MVP1 | MVP2 | MVP3 |
|--------|------|------|------|
| 예약·리포트·자격 결과 | 이메일 + 인앱 | + **푸시** | 동일 |
| 채팅 | 인앱·WebSocket | + **푸시** | 동일 |
| 케어 과제 | — | 인앱(선택) | + 푸시·이메일 |
| EEG 완료 | — | **푸시** | 동일 |

### 8.2 설계 원칙

- **웹 푸시(Web Push)는 사용하지 않음** — MVP1은 이메일+인앱, MVP2부터 FCM/APNs.
- MVP1: 인앱·이메일만으로도 핵심 이벤트 확인 가능 (폴백).
- 사용자 알림 설정은 웹 UI, 네이티브는 수신·표시만.

---

## 9. AI 파이프라인

> **벤더·폴백 단일 기준:** `docs/AI_STACK_DECISION.md` v1.0.0

```
음성 녹음 → [1차] Gemini Audio (STT+화자) → [2차] Whisper + pyannote
       ↓
Claude 요약·기록지 → [폴백] Gemini 동일 템플릿 → 리포트 (§18 승인 후 발송)

증빙 업로드 → Gemini Vision OCR → 규칙 엔진 → 어드민 큐(needs_review)

LINK BAND Raw → Looxid SDK → 리포트 통합 (선택)
```

### 9.1 AI 구성 요소

| 단계 | 1차 | 폴백 | 역할 |
|------|-----|------|------|
| STT+화자 | Gemini Audio | Whisper + pyannote | F7 |
| 상담 요약 | Claude | Gemini | F7·F8 |
| 증빙 OCR·분류 | Gemini Vision | 어드민 수동 | F3.5·F2.2 |
| EEG 분석 | Looxid SDK | — | F9.4 |

### 9.2 세션 유형별 AI 요약 항목

| 세션 유형 | 요약 항목 | 기록지 포함 |
|----------|----------|-----------|
| **임상 심리상담** | 주요 호소 사항·감정 변화·상담사 개입 포인트 | 세션 요약·뇌파 분석(선택)·다음 제안·메모 |
| **최면 심리상담** | 최면 단계별 뇌파 변화·의식/무의식 전환·유도 기법 | 최면 과정·뇌파 그래프(선택)·다음 권고 |
| **명상 수업** | 수업 흐름·참여자 평균 이완도·구간별 효과 | 수업 콘텐츠·참여자 데이터(선택)·효과 통계 |

---

## 10. 기술 아키텍처

### 10.1 시스템 구성도

| 계층 | 기술 | 역할 |
|------|------|------|
| Frontend (웹) | React 18 + TypeScript, Vite | SPA — 관리자·내담자 **단일 UI·도메인 로직** (1단계~) |
| Hybrid Shell (2·3단계) | React Native 최소 셸 (WebView) | FCM/APNs 푸시(2단계), BLE 브리지(3단계)만 네이티브 |
| BLE (1단계) | Web Bluetooth API | 상담사 PC·Android Chrome — 세션실 EEG(선택) |
| BLE (3단계) | RN 네이티브 모듈 | iOS·모바일 내담자 LINK BAND 연결 |
| Realtime | Socket.IO | 실시간 뇌파·채팅·세션 상태 |
| Backend | FastAPI (Python) | REST API, 인증, 세션·내담자 관리 |
| Async Queue | Celery + Redis | STT 변환·AI 요약·리포트 생성 |
| Database | PostgreSQL | OLTP. EEG Raw는 **S3 Parquet**, 메타는 `EEGRecord` |
| Storage | S3 호환 | 음성 녹음·리포트 PDF·미디어 |
| AI/ML | Looxid SDK + LLM API | EEG 분석 + 상담 요약 |

### 10.2 기술 스택 상세

**Frontend (웹 — 1단계 핵심)**
- React 18+ (TypeScript) — SPA (관리자 + 내담자 모바일 웹)
- TanStack Query — 서버 상태·캐싱
- Zustand — 클라이언트 상태 (BLE 연결·실시간 데이터)
- Recharts / D3.js — 뇌파 차트·리포트 시각화
- Web Bluetooth API — 1단계: 상담사 데스크톱 세션실(선택)
- Web Audio API — 브라우저 음성 녹음

**Hybrid Shell (2·3단계 — 보강만)**
- React Native — WebView 호스팅, 앱 스토어 배포
- `@react-native-firebase/messaging` 또는 동등 — FCM/APNs (2단계)
- RN BLE 모듈 — LINK BAND GATT·EEG 스트림 → JS 브리지 (3단계)
- **비목표:** RN 전면 UI 재작성, 도메인 로직 이중 구현

**Backend**
- FastAPI (Python) — REST API + WebSocket
- Celery + Redis — 비동기 작업 큐
- Socket.IO — 실시간 EEG·채팅
- SQLAlchemy + Alembic — ORM·마이그레이션

---

## 11. 핵심 데이터 모델

| 엔티티 | 주요 필드 | 관계 | 비고 |
|--------|----------|------|------|
| **User** | id, email, name, role(전문가/내담자), profile | 1:N Session | — |
| **Session** | id, type(임상/최면/명상), status, scheduledAt, duration, hostId | N:1 User(host), N:M User(participant) | — |
| **EEGRecord** | id, sessionId, userId, timestamp, rawData, analysisResult | N:1 Session, N:1 User | **LINK BAND 착용 시에만 생성** |
| **SessionRecord** | id, sessionId, transcript, aiSummary, markers[], counselorNotes | 1:1 Session | — |
| **Report** | id, sessionId, userId, type(상담사/내담자), content, pdfUrl | N:1 Session, N:1 User | — |
| **TrainingProgram** | id, clientId, counselorId, type, schedule, exercises[] | N:1 User(counselor), N:1 User(client) | **MVP3** |
| **TrainingLog** | id, programId, completedAt, eegSummary(nullable), duration | N:1 TrainingProgram | **MVP3** |

---

## 12. 디자인 시스템 — Clinical Garden

> **SSOT:** `design-system/brand/identity.md` v1.0.0 + `design-system/tokens/` (W3C Design Tokens)
> **빌드:** Style Dictionary → `design-system/build/outputs/` (CSS 변수·Tailwind preset·TS 타입)
> **IA 참고:** `design/front-master.pen` (Pencil 프로토타입 — 화면 구조는 유지, 시각 언어는 본 §12로 대체)

### 12.0 North Star

> **"과학으로 검증된 평온함 — 차분한 자연의 톤으로 신뢰를 만드는 멘탈 케어 플랫폼."**

화려함이 아닌 **고요한 권위(quiet authority)**. 상담사가 안심하고 내담자를 모실 수 있는 공간이며, 내담자가 자기 자신을 마주할 수 있는 따뜻한 인터페이스.

**비포지셔닝:** 의료기기 아님 · "마음을 고친다" 약속 안 함 · 게이미피케이션 없음 · 네온·사이버펑크 아님 · 영문 가독성을 한글보다 우선하지 않음.

### 12.1 컬러 시스템 — Nature-First

```
배경:          oat #F4F1E8    ←  흰색 아닌 따뜻한 베이지 (첫인상 결정)
본문:     deep slate #2C3E50    ←  순수 검정 아닌 깊은 청회색
브랜드:        sage #88A887    ←  차분한 녹색 (명상·심리 도메인에서 보기 드문 선택)
액센트:  dawn coral #E8B4A0    ←  따뜻한 포인트
         morning sky #A5C5D6   ←  차분한 보조
```

| 토큰 | 값 | Tailwind | 용도 |
|------|-----|----------|------|
| `--surface-canvas` | `#F4F1E8` | `bg-surface-canvas` | 메인 배경 |
| `--surface-elevated` | `#FAF8F2` | `bg-surface-elevated` | 카드·모달 |
| `--surface-raised` | `#FFFFFF` | `bg-surface-raised` | 최상위 컨테이너 |
| `--ink-primary` | `#2C3E50` | `text-ink-primary` | 본문 |
| `--ink-secondary` | `#5C6B7A` | `text-ink-secondary` | 보조 텍스트 |
| `--brand-primary` | `#88A887` | `bg-brand-primary` | 주요 액션·CTA |
| `--brand-primary-hover` | `#6E8E6C` | `hover:bg-brand-primary-hover` | 호버 |
| `--accent-warm` | `#E8B4A0` | `text-accent-warm` | 강조 포인트 |
| `--status-success` | `#6B9A6B` | `text-status-success` | 완료·긍정 (leaf) |
| `--status-warning` | `#D4956B` | `text-status-warning` | 주의 (clay) |
| `--status-danger` | `#B85C5C` | `text-status-danger` | 위험 (earth) — 순수 red 의도적 배제 |
| `--status-info` | `#6B9AB3` | `text-status-info` | 정보 (river) |

**원칙:** 저채도 + 1포인트 · 빨강 대신 earth · 명도 대비로 위계 · WCAG AA 4.5:1 필수.
**다크 모드:** 베이스 `#1A1D1A` (숲의 어둠), sage 명도 상향 `#A8C0A7`.

### 12.2 타이포그래피

| 역할 | 폰트 | 이유 |
|------|------|------|
| **Display (영문)** | **Fraunces** | 따뜻한 세리프. 식물학 저널·자연 다큐멘터리 분위기 |
| **Body (영문)** | **Inter** | 한국 검증된 산세리프. Pretendard와 메트릭 일치 |
| **Body (한글)** | **Pretendard Variable** | 한국어 디지털 환경 사실상 표준 |
| **Mono** | **JetBrains Mono** | 기술 라벨 한정 (디바이스 ID, EEG 채널명, 시간 코드) |

**원칙:** Display는 24px 이상에서만 · Mono는 본문에 쓰지 않음 · 굵기는 Light(300)·Regular(400)·Medium(500)·Bold(700) 4단계만 · 이탤릭 거의 안 씀.

### 12.3 시그니처 — Breath Circle

브랜드의 **단 하나의 잊히지 않는 모티프**. 세 겹 동심원이 4초 들숨·4초 날숨 리듬으로 부드럽게 확장·수축.

- 로딩 인디케이터 (스피너 대체)
- 빈 상태(Empty state) — "잠시의 여백"
- 세션 시작 화면 — 시각적 호흡 가이드
- `Verified+` 인증 뱃지에 새순(잎) 모티프
- `prefers-reduced-motion: reduce` 환경에서는 정지된 동심원

### 12.4 형태·모서리

| 토큰 | 값 | 용도 |
|------|-----|------|
| `--radius-sm` | 8px | 작은 칩·태그 |
| `--radius-md` | 12px | 입력 필드·작은 카드 |
| `--radius-lg` | 20px | 카드·모달 — Clinical Garden의 시그니처 곡률 |
| `--radius-xl` | 32px | 히어로 카드·큰 컨테이너 |
| `--radius-pill` | 999px | 버튼·뱃지·채팅 버블 |

**원칙:** 직각보다 곡률. 모든 표면은 손이 닿을 수 있게 부드럽다.

### 12.5 공간·그리드

- **기본 단위:** 4px (스케일: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96, 128)
- **그리드:** 12-column, gutter 24px (데스크톱) / 16px (모바일)
- **컨테이너 최대 폭:** 1280px (앱), 1440px (마케팅)
- **여백 철학:** 여백은 콘텐츠보다 중요하다. 카드 내부 padding은 절대 줄이지 않는다.

### 12.6 모션 — The Three Speeds

| 종류 | duration | easing | 사용처 |
|------|---------|--------|--------|
| **Instant** | 100-150ms | `ease-out` | 호버·포커스·토글 |
| **Smooth** | 200-300ms | `cubic-bezier(0.16, 1, 0.3, 1)` | 페이지 전이·모달·카드 펼침 |
| **Breath** | 4000ms | `ease-in-out` infinite | Breath Circle·로딩·명상 가이드 |

**금지:** 튕김(bounce)·출렁임(elastic)·패럴랙스 과다·자동 재생 비디오. `prefers-reduced-motion: reduce` 존중 필수.

### 12.7 Voice & Tone

- **차분하다** — 느낌표를 거의 쓰지 않는다
- **정확하다** — 수치·근거·출처를 동반한다
- **약속하지 않는다** — "스트레스가 사라집니다" ❌ → "스트레스 지표를 관찰합니다" ✅
- **존중한다** — "환자"가 아니라 "내담자", 명령형이 아니라 권유형

| 상황 | ❌ 일반적 | ✅ MIND BREEZE |
|------|----------|---------------|
| 세션 시작 | "지금 바로 시작하세요!" | "준비되시면 시작합니다." |
| 녹음 권한 | "녹음을 허용해주세요!" | "기록을 위해 마이크 사용 동의가 필요합니다." |
| EEG 미연결 | "LINK BAND를 연결하지 못했습니다 😢" | "지금은 LINK BAND 없이 진행합니다." |
| 분석 완료 | "분석이 완료되었어요!" | "리포트가 준비되었습니다." |

### 12.8 접근성

| 항목 | 기준 |
|------|------|
| 본문 대비 | 4.5:1 (AA) 최소, 7:1 (AAA) 권장 |
| 포커스 링 | 2px solid `brand-deep`, offset 2px |
| 키보드 네비게이션 | 모든 인터랙티브 요소 도달 가능 |
| 스크린 리더 | aria 라벨 필수, semantic HTML 우선 |
| 폰트 크기 | 본문 16px 미만 금지 (Caption만 14px 허용) |
| 라인 높이 | 본문 1.6, 헤드라인 1.2 |

### 12.9 토큰 빌드 파이프라인

```
tokens/brand/color.json   ─┐
tokens/system/light.json   ┤  Style Dictionary  →  build/outputs/
tokens/ui/button.json     ─┘                           ├── css/tokens.css
                                                       ├── tailwind/preset.cjs
                                                       └── ts/tokens.ts
```

**변경 절차:** `identity.md` 갱신 → `tokens/*.json` 갱신 → `npm run build` → 빌드 출력 커밋. 토큰 3계층(Brand → System → UI) 준수, 상위 계층 직접 참조 금지.

---

## 13. MVP 단계별 로드맵 (총 31주)

### 13.1 전체 타임라인

| MVP | 핵심 목표 | 기간 | 주요 산출물 |
|:---:|----------|:---:|-------------|
| **MVP1** | 웹 플랫폼 + B2B 인증 + AI 기록·리포트 + **상담센터 PC BLE** | **17주** | F1~F8·F9.1~4·F10(MVP1)·F11·F14 — `기능명세서` §6 |
| **MVP2** | 앱 + 앱 BLE + 네이티브 푸시 | **8주** | F12·F9.5·9.6·F10.4 |
| **MVP3** | 케어·트레이닝·AI·통계 고도화 | **6주** | F13·F3.4·F5.5·F6.3·F8.4 등 |
| **총계** | **단일 제품 로드맵** | **31주** | 개발 착수 전 문서·승인 게이트(§18) 정합 |

### 13.2 MVP1 — 웹 + 상담센터 BLE + 자격 증명 + AI (17주)

1. 계정·온보딩·B2B 센터·상담사 자격(F2·F3·F3.5·F11)
2. 내담자·세션·채팅·인앱·이메일 알림
3. 음성 녹음·STT·기록지·리포트 (`AI_STACK_DECISION.md`)
4. 상담사 PC Web Bluetooth·EEG 대시보드·오프라인 분석
5. 보안·동의·RBAC·감사 로그(F14)

### 13.3 MVP2 — 앱 + 앱 BLE + 푸시 (8주)

1. RN WebView 셸·스토어 배포·딥링크
2. FCM/APNs·디바이스 토큰 API
3. RN BLE 브리지 → 기존 EEG 파이프라인 재사용
4. 명상 다자 그리드(F9.5, P1)
5. 모바일 증빙 촬영·재제출(F12.4)

### 13.4 MVP3 — AI · 케어 고도화 (6주)

1. 셀프 트레이닝·케어 워크플로(F13)
2. AI 요약·리포트 품질·프롬프트 튜닝
3. 반복 일정·저널·PDF·메시지 검색 등 P2 기능
4. 자격 만료·코호트 통계(F3.4·F13.5)

---

## 14. 내부 스프린트 구성 (제안)

> 아래는 **MVP 마일스톤 안**의 2주 단위 실행 계획이다. 제품 릴리스 단위는 §13의 MVP1~3만 사용한다.

### MVP1 내부 (17주)

| 주차 블록 | 기간 | 범위 |
|:---:|:---:|------|
| **Sprint 0** | 1주 | 저장소·CI/CD·DB·F14 최소·디자인 토큰 |
| **Sprint 1–2** | 4주 | F1·F2·F3·F11 (인증·B2B·어드민 큐) |
| **Sprint 3–4** | 4주 | F4·F5·F6·F10 (내담자·세션·채팅·알림) |
| **Sprint 5–6** | 4주 | F7·F8 (`AI_STACK_DECISION` POC 포함) |
| **Sprint 7–8** | 3주 | F9.1~4 (PC BLE·EEG) |
| **Sprint 9** | 1주 | MVP1 통합 QA·배포 |

### MVP2 내부 (8주)

| 주차 블록 | 기간 | 범위 |
|:---:|:---:|------|
| **Sprint 10–11** | 4주 | F12·F10.4 (RN 셸·푸시) |
| **Sprint 12–13** | 3주 | F9.5·9.6 (앱 BLE·그리드) |
| **Sprint 14** | 1주 | 스토어·권한·폴백 QA |

### MVP3 내부 (6주)

| 주차 블록 | 기간 | 범위 |
|:---:|:---:|------|
| **Sprint 15–16** | 4주 | F13·케어 IA |
| **Sprint 17** | 2주 | AI 고도화·P2·통합 QA |

---

## 15. 성공 지표

| 지표 | 정의 | 목표 방향 |
|------|------|:---:|
| 세션 완료율 | 생성된 세션 중 완료 비율 | 증가 |
| 녹음·요약 성공률 | STT+요약 작업 성공 비율 | ≥95% |
| LINK BAND 사용률 | opt-in 세션 비율 | 서비스 정책에 따름 |
| 리포트 발송률 | 완료 세션 대비 리포트 발송 비율 | 증가 |
| 전문가 NPS | 상담사·지도사 만족도 | 기준선 대비 개선 |
| 주간 활성 사용자(WAU) | 주간 로그인 사용자 수 | 증가 |
| 케어 과제 완료율 | 처방된 과제 중 완료 비율 | 증가 (MVP3) |

---

## 16. 리스크 및 대응

| 리스크 | 영향 | 대응 전략 |
|--------|:---:|------|
| Web Bluetooth 브라우저 제약 | iOS·모바일 Safari에서 BLE 불가 | MVP1=상담사 PC만; **MVP2** RN BLE |
| 네이티브 푸시 미구현 기간 | 백그라운드 알림 누락 | MVP1 이메일·인앱; **MVP2** 푸시 |
| AI 파이프라인 지연 | STT·LLM 응답 10초↑ | Celery 비동기 처리, 진행률 UI, 폴백 캐싱 |
| 뇌파 데이터 프라이버시 | 규제 리스크 | 동의 플로우, 암호화, 접근 로그, 개인정보보호법 준수 |
| 범위 확장(Creep) | 일정 지연 | spec.md 기반 엄격한 범위 관리, MVP3 이후로 연기 |
| LINK BAND 하드웨어 이슈 | EEG 데이터 누락 | 모든 기능은 미착용 시에도 완전 동작, BLE 연결 상태 UI |
| 개발 리소스 부족 | 일정 지연 | Claude Code Worker 활용 자동화, BE/FE 분할 개발 |

---

## 17. 오픈 이슈

1. **RN 셸 방식:** WebView 단일 vs CodePush/OTA 정책
2. **반복 일정:** MVP3(F5.5) — MVP1에서는 수동 복제
3. **채팅 방식:** 자체 WebSocket(F6) vs 외부 채널
4. **LINK Cloud SDK:** MVP1 BLE 착수 전 스펙·라이선스
5. **멀티테넌트:** MVP1 `orgId` 설계 범위
6. **의료기기 인증:** LINK BAND 비의료 고지(F14.7)

> **해소됨:** 총 일정 **31주(MVP1·2·3)**. 알림 MVP1=이메일+인앱, MVP2=푸시. STT/LLM → `AI_STACK_DECISION.md` v1.0.0 (Proposed).

---

## 18. 브라이언 승인 게이트

아래 항목은 자동 실행하지 않고 Brian 승인 후 진행:

- 외부 발송 (이메일·알림·리포트)
- 가격·견적·할인
- 계약·NDA·MSA·SOW·DPA·약관
- 법무 문구
- 지급·정산·세무·회계 문서
- 대외 공개 페이지·공지
- 고비용·고위험 의사결정

---

*본 문서는 MIND BREEZE 2.0의 모든 기획 산출물을 단일 종합 기획서로 통합한 것입니다. 수정 시 **§0** 절차를 따릅니다. 개발 착수 전 `MIND_BREEZE_2.0_기능명세서.md`·`AI_STACK_DECISION.md`와 정합을 확인한다.*

**문서 식별:** `mindbreeze-2.0-master-plan` · 현재 `v1.2.0`
