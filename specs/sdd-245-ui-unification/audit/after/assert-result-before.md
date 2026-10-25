# 홈 대비 허용폭 충족표
허용폭 ±1px · 총 324표본 · 평가 292 · 범위 밖 32

- 엄격 충족(본문 시작선 홈 대비 ±1px): **124/292**
- 승인 예외 포함(읽기 폭 18 + 독립 레이아웃 121): **263/292**
- 미충족(FAIL): **29**
- 제목 22/700: 168/234

| 판정 | 경로 | 역할 | 폭 | 본문 시작선 | 홈 | Δ | 사유 |
|---|---|---|---:|---:|---:|---:|---|
| EXC-INDEPENDENT | `/app/ai` | client | 1440 | 240 | 280 | -40 | 채팅(루시) 화면으로 리다이렉트 — 분할 구조 |
| EXC-INDEPENDENT | `/app/chat/lucy` | client | 1440 | 240 | 280 | -40 | 채팅 대화면 분할 구조(spec 비범위·D3) |
| EXC-INDEPENDENT | `/app/chat/sample-room` | client | 1440 | 620 | 280 | 340 | 채팅 대화면 분할 구조(spec 비범위·D3) |
| EXC-INDEPENDENT | `/app/chat` | client | 1440 | 240 | 280 | -40 | 채팅 대화면 분할 구조(spec 비범위·D3) |
| FAIL | `/app/classes/sample-class` | client | 1440 | 320 | 280 | 40 |  |
| FAIL | `/app/classes` | client | 1440 | 320 | 280 | 40 |  |
| FAIL | `/app/counseling/sample-relationship` | client | 1440 | 264 | 280 | -16 |  |
| FAIL | `/app/counseling` | client | 1440 | 264 | 280 | -16 |  |
| EXC-READING | `/app/notifications` | client | 1440 | 504 | 280 | 224 | 읽기·폼 폭 672px 중앙 정렬 유지(D3), 셸 시작선 280=홈 280 |
| EXC-READING | `/app/participation-profile` | client | 1440 | 536 | 280 | 256 | 읽기·폼 폭 672px 중앙 정렬 유지(D3), 셸 시작선 280=홈 280 |
| EXC-READING | `/app/profile` | client | 1440 | 504 | 280 | 224 | 읽기·폼 폭 672px 중앙 정렬 유지(D3), 셸 시작선 280=홈 280 |
| FAIL | `/app/sessions` | client | 1440 | 320 | 280 | 40 |  |
| EXC-INDEPENDENT | `/chat/sample-room` | client | 1440 | 620 | 280 | 340 | 채팅 대화면 분할 구조(spec 비범위·D3) |
| EXC-INDEPENDENT | `/chat` | client | 1440 | 240 | 280 | -40 | 채팅 대화면 분할 구조(spec 비범위·D3) |
| OUT | `/design/class-player?role=member&case=M02` | client | 1440 | - | - | - | 시안 /design/* 은 제품 이관 대상 아님 |
| EXC-READING | `/notifications` | client | 1440 | 504 | 280 | 224 | 읽기·폼 폭 672px 중앙 정렬 유지(D3), 셸 시작선 280=홈 280 |
| EXC-INDEPENDENT | `/onboarding/client/essentials` | client | 1440 | 496 | 280 | 216 | 온보딩 — 셸 없는 독립 레이아웃 |
| EXC-INDEPENDENT | `/onboarding/client` | client | 1440 | 0 | 280 | -280 | 온보딩 — 셸 없는 독립 레이아웃 |
| EXC-INDEPENDENT | `/org/requests` | client | 1440 | 336 | 280 | 56 | AppShell 밖 독립 화면(사이드바 없음) — 편입은 화면 구성 변경이라 제외, 읽기·폼 폭 유지(D3), 제목·카드·CTA 토큰은 적용 |
| EXC-INDEPENDENT | `/sessions/sample-session/live` | client | 1440 | 104 | 280 | -176 | 수업 진행·몰입 플레이어·기록 화면 — 몰입 화면 제외(D1) |
| OUT | `/sessions/sample-session/player` | client | 1440 | - | - | - | 몰입 플레이어 제외(D1) |
| EXC-READING | `/settings` | client | 1440 | 504 | 280 | 224 | 읽기·폼 폭 672px 중앙 정렬 유지(D3), 셸 시작선 280=홈 280 |
| EXC-INDEPENDENT | `/app/ai` | client | 390 | 0 | 16 | -16 | 채팅(루시) 화면으로 리다이렉트 — 분할 구조 |
| EXC-INDEPENDENT | `/app/chat/lucy` | client | 390 | 0 | 16 | -16 | 채팅 대화면 분할 구조(spec 비범위·D3) |
| EXC-INDEPENDENT | `/app/chat` | client | 390 | 0 | 16 | -16 | 채팅 대화면 분할 구조(spec 비범위·D3) |
| EXC-INDEPENDENT | `/chat` | client | 390 | 0 | 16 | -16 | 채팅 대화면 분할 구조(spec 비범위·D3) |
| OUT | `/design/class-player?role=member&case=M02` | client | 390 | - | - | - | 시안 /design/* 은 제품 이관 대상 아님 |
| EXC-INDEPENDENT | `/onboarding/client` | client | 390 | 0 | 16 | -16 | 온보딩 — 셸 없는 독립 레이아웃 |
| OUT | `/sessions/sample-session/player` | client | 390 | - | - | - | 몰입 플레이어 제외(D1) |
| EXC-INDEPENDENT | `/agent` | counselor | 1440 | 620 | 280 | 340 | 상담사 AI 대화(루시) — 채팅 분할 구조 |
| EXC-INDEPENDENT | `/chat/sample-room` | counselor | 1440 | 620 | 280 | 340 | 채팅 대화면 분할 구조(spec 비범위·D3) |
| EXC-INDEPENDENT | `/chat` | counselor | 1440 | 240 | 280 | -40 | 채팅 대화면 분할 구조(spec 비범위·D3) |
| EXC-INDEPENDENT | `/classes/new` | counselor | 1440 | 0 | 280 | -280 | 클래스 편성 마법사 — 독립 풀스크린 레이아웃 |
| EXC-INDEPENDENT | `/classes/now` | counselor | 1440 | 0 | 280 | -280 | 즉시 수업 대기실 — 몰입 진입 전 공간 배치 유지(D1) |
| FAIL | `/classes/sample-class/members` | counselor | 1440 | 264 | 280 | -16 |  |
| FAIL | `/classes/sample-class/schedule` | counselor | 1440 | 264 | 280 | -16 |  |
| FAIL | `/classes/sample-class/sessions/sample-session` | counselor | 1440 | 360 | 280 | 80 |  |
| FAIL | `/classes/sample-class/sessions` | counselor | 1440 | 264 | 280 | -16 |  |
| FAIL | `/classes/sample-class/settings` | counselor | 1440 | 264 | 280 | -16 |  |
| FAIL | `/classes/sample-class` | counselor | 1440 | 264 | 280 | -16 |  |
| FAIL | `/classes` | counselor | 1440 | 264 | 280 | -16 |  |
| EXC-INDEPENDENT | `/clients/invite` | counselor | 1440 | 432 | 280 | 152 | AppShell 밖 독립 화면(사이드바 없음) — 편입은 화면 구성 변경이라 제외, 읽기·폼 폭 유지(D3), 제목·카드·CTA 토큰은 적용 |
| EXC-INDEPENDENT | `/counseling/new` | counselor | 1440 | 24 | 280 | -256 | 상담 생성 마법사 — 독립 풀스크린 레이아웃 |
| FAIL | `/counseling/sample-relationship/sessions/sample-session` | counselor | 1440 | 360 | 280 | 80 |  |
| FAIL | `/counseling/sample-relationship` | counselor | 1440 | 264 | 280 | -16 |  |
| FAIL | `/counseling` | counselor | 1440 | 264 | 280 | -16 |  |
| EXC-INDEPENDENT | `/credentials` | counselor | 1440 | 320 | 280 | 40 | AppShell 밖 독립 화면(사이드바 없음) — 편입은 화면 구성 변경이라 제외, 읽기·폼 폭 유지(D3), 제목·카드·CTA 토큰은 적용 |
| OUT | `/design/app` | counselor | 1440 | - | - | - | 시안 /design/* 은 제품 이관 대상 아님 |
| OUT | `/design/class-flow` | counselor | 1440 | - | - | - | 시안 /design/* 은 제품 이관 대상 아님 |
| OUT | `/design/class-player` | counselor | 1440 | - | - | - | 시안 /design/* 은 제품 이관 대상 아님 |
| OUT | `/design/docs` | counselor | 1440 | - | - | - | 시안 /design/* 은 제품 이관 대상 아님 |
| OUT | `/design/homepage` | counselor | 1440 | - | - | - | 시안 /design/* 은 제품 이관 대상 아님 |
| OUT | `/design/report` | counselor | 1440 | - | - | - | 시안 /design/* 은 제품 이관 대상 아님 |
| OUT | `/design/user-app` | counselor | 1440 | - | - | - | 시안 /design/* 은 제품 이관 대상 아님 |
| OUT | `/design` | counselor | 1440 | - | - | - | 시안 /design/* 은 제품 이관 대상 아님 |
| EXC-INDEPENDENT | `/membership-invite?token=synthetic-invite-token` | counselor | 1440 | 0 | 280 | -280 | 공개 초대 수락 — 셸 없는 독립 레이아웃 |
| OUT | `/membership-invite` | counselor | 1440 | - | - | - | 토큰 미제공 안내 상태 화면 — 정상 페이지 측정 아님 |
| EXC-READING | `/notifications` | counselor | 1440 | 504 | 280 | 224 | 읽기·폼 폭 672px 중앙 정렬 유지(D3), 셸 시작선 280=홈 280 |
| EXC-INDEPENDENT | `/onboarding/counselor` | counselor | 1440 | 420 | 280 | 140 | 온보딩 — 셸 없는 독립 레이아웃 |
| EXC-INDEPENDENT | `/org/requests` | counselor | 1440 | 336 | 280 | 56 | AppShell 밖 독립 화면(사이드바 없음) — 편입은 화면 구성 변경이라 제외, 읽기·폼 폭 유지(D3), 제목·카드·CTA 토큰은 적용 |
| EXC-INDEPENDENT | `/org/sample-org` | counselor | 1440 | 272 | 280 | -8 | AppShell 밖 독립 화면(사이드바 없음) — 편입은 화면 구성 변경이라 제외, 읽기·폼 폭 유지(D3), 제목·카드·CTA 토큰은 적용 |
| EXC-INDEPENDENT | `/org/search` | counselor | 1440 | 272 | 280 | -8 | AppShell 밖 독립 화면(사이드바 없음) — 편입은 화면 구성 변경이라 제외, 읽기·폼 폭 유지(D3), 제목·카드·CTA 토큰은 적용 |
| EXC-READING | `/profile/professional` | counselor | 1440 | 504 | 280 | 224 | 읽기·폼 폭 672px 중앙 정렬 유지(D3), 셸 시작선 280=홈 280 |
| EXC-READING | `/reports/sample-report` | counselor | 1440 | 392 | 280 | 112 | 읽기·폼 폭 896px 중앙 정렬 유지(D3), 셸 시작선 280=홈 280 |
| EXC-READING | `/reports` | counselor | 1440 | 489.28125 | 280 | 209.28125 | 읽기·폼 폭 120px 중앙 정렬 유지(D3), 셸 시작선 280=홈 280 |
| EXC-INDEPENDENT | `/sessions/new` | counselor | 1440 | 0 | 280 | -280 | 세션 생성 풀스크린 폼 — 독립 레이아웃 |
| EXC-INDEPENDENT | `/sessions/sample-session/class-report` | counselor | 1440 | 352 | 280 | 72 | 문서형 리포트 — 읽기 폭 유지(D3), 모바일 좌우 16은 통일 |
| EXC-INDEPENDENT | `/sessions/sample-session/live` | counselor | 1440 | 352 | 280 | 72 | 수업 진행·몰입 플레이어·기록 화면 — 몰입 화면 제외(D1) |
| EXC-INDEPENDENT | `/sessions/sample-session/player` | counselor | 1440 | 352 | 280 | 72 | 수업 진행·몰입 플레이어·기록 화면 — 몰입 화면 제외(D1) |
| EXC-INDEPENDENT | `/sessions/sample-session/summary` | counselor | 1440 | 352 | 280 | 72 | 문서형 리포트 — 읽기 폭 유지(D3), 모바일 좌우 16은 통일 |
| FAIL | `/sessions/sample-session` | counselor | 1440 | 360 | 280 | 80 |  |
| FAIL | `/sessions` | counselor | 1440 | 264 | 280 | -16 |  |
| EXC-READING | `/settings` | counselor | 1440 | 504 | 280 | 224 | 읽기·폼 폭 672px 중앙 정렬 유지(D3), 셸 시작선 280=홈 280 |
| EXC-INDEPENDENT | `/chat` | counselor | 390 | 0 | 16 | -16 | 채팅 대화면 분할 구조(spec 비범위·D3) |
| EXC-INDEPENDENT | `/classes/new` | counselor | 390 | 0 | 16 | -16 | 클래스 편성 마법사 — 독립 풀스크린 레이아웃 |
| EXC-INDEPENDENT | `/classes/now` | counselor | 390 | 0 | 16 | -16 | 즉시 수업 대기실 — 몰입 진입 전 공간 배치 유지(D1) |
| EXC-INDEPENDENT | `/clients/invite` | counselor | 390 | 24 | 16 | 8 | AppShell 밖 독립 화면(사이드바 없음) — 편입은 화면 구성 변경이라 제외, 읽기·폼 폭 유지(D3), 제목·카드·CTA 토큰은 적용 |
| OUT | `/design/app` | counselor | 390 | - | - | - | 시안 /design/* 은 제품 이관 대상 아님 |
| OUT | `/design/class-flow` | counselor | 390 | - | - | - | 시안 /design/* 은 제품 이관 대상 아님 |
| OUT | `/design/class-player` | counselor | 390 | - | - | - | 시안 /design/* 은 제품 이관 대상 아님 |
| OUT | `/design/docs` | counselor | 390 | - | - | - | 시안 /design/* 은 제품 이관 대상 아님 |
| OUT | `/design/homepage` | counselor | 390 | - | - | - | 시안 /design/* 은 제품 이관 대상 아님 |
| OUT | `/design/report` | counselor | 390 | - | - | - | 시안 /design/* 은 제품 이관 대상 아님 |
| OUT | `/design/user-app` | counselor | 390 | - | - | - | 시안 /design/* 은 제품 이관 대상 아님 |
| OUT | `/design` | counselor | 390 | - | - | - | 시안 /design/* 은 제품 이관 대상 아님 |
| EXC-INDEPENDENT | `/membership-invite?token=synthetic-invite-token` | counselor | 390 | 0 | 16 | -16 | 공개 초대 수락 — 셸 없는 독립 레이아웃 |
| OUT | `/membership-invite` | counselor | 390 | - | - | - | 토큰 미제공 안내 상태 화면 — 정상 페이지 측정 아님 |
| EXC-INDEPENDENT | `/sessions/new` | counselor | 390 | 0 | 16 | -16 | 세션 생성 풀스크린 폼 — 독립 레이아웃 |
| EXC-INDEPENDENT | `/sessions/sample-session/class-report` | counselor | 390 | 12 | 16 | -4 | 문서형 리포트 — 읽기 폭 유지(D3), 모바일 좌우 16은 통일 |
| EXC-INDEPENDENT | `/sessions/sample-session/live` | counselor | 390 | 12 | 16 | -4 | 수업 진행·몰입 플레이어·기록 화면 — 몰입 화면 제외(D1) |
| EXC-INDEPENDENT | `/sessions/sample-session/player` | counselor | 390 | 12 | 16 | -4 | 수업 진행·몰입 플레이어·기록 화면 — 몰입 화면 제외(D1) |
| EXC-INDEPENDENT | `/sessions/sample-session/summary` | counselor | 390 | 12 | 16 | -4 | 문서형 리포트 — 읽기 폭 유지(D3), 모바일 좌우 16은 통일 |
| EXC-INDEPENDENT | `/chat/sample-room` | org_admin | 1440 | 620 | 280 | 340 | 채팅 대화면 분할 구조(spec 비범위·D3) |
| EXC-INDEPENDENT | `/chat` | org_admin | 1440 | 240 | 280 | -40 | 채팅 대화면 분할 구조(spec 비범위·D3) |
| EXC-INDEPENDENT | `/classes/new` | org_admin | 1440 | 0 | 280 | -280 | 클래스 편성 마법사 — 독립 풀스크린 레이아웃 |
| EXC-INDEPENDENT | `/classes/now` | org_admin | 1440 | 0 | 280 | -280 | 즉시 수업 대기실 — 몰입 진입 전 공간 배치 유지(D1) |
| FAIL | `/classes/sample-class/members` | org_admin | 1440 | 264 | 280 | -16 |  |
| FAIL | `/classes/sample-class/schedule` | org_admin | 1440 | 264 | 280 | -16 |  |
| FAIL | `/classes/sample-class/sessions/sample-session` | org_admin | 1440 | 360 | 280 | 80 |  |
| FAIL | `/classes/sample-class/sessions` | org_admin | 1440 | 264 | 280 | -16 |  |
| FAIL | `/classes/sample-class/settings` | org_admin | 1440 | 264 | 280 | -16 |  |
| FAIL | `/classes/sample-class` | org_admin | 1440 | 264 | 280 | -16 |  |
| FAIL | `/classes` | org_admin | 1440 | 264 | 280 | -16 |  |
| OUT | `/clients/invite` | org_admin | 1440 | - | - | - | 권한 안내 상태 화면 — 정상 페이지 측정 아님 |
| EXC-INDEPENDENT | `/counseling/new` | org_admin | 1440 | 24 | 280 | -256 | 상담 생성 마법사 — 독립 풀스크린 레이아웃 |
| FAIL | `/counseling/sample-relationship/sessions/sample-session` | org_admin | 1440 | 360 | 280 | 80 |  |
| FAIL | `/counseling/sample-relationship` | org_admin | 1440 | 264 | 280 | -16 |  |
| FAIL | `/counseling` | org_admin | 1440 | 264 | 280 | -16 |  |
| EXC-INDEPENDENT | `/membership-invite?token=synthetic-invite-token` | org_admin | 1440 | 0 | 280 | -280 | 공개 초대 수락 — 셸 없는 독립 레이아웃 |
| OUT | `/membership-invite` | org_admin | 1440 | - | - | - | 토큰 미제공 안내 상태 화면 — 정상 페이지 측정 아님 |
| EXC-READING | `/notifications` | org_admin | 1440 | 504 | 280 | 224 | 읽기·폼 폭 672px 중앙 정렬 유지(D3), 셸 시작선 280=홈 280 |
| EXC-INDEPENDENT | `/org/requests` | org_admin | 1440 | 336 | 280 | 56 | AppShell 밖 독립 화면(사이드바 없음) — 편입은 화면 구성 변경이라 제외, 읽기·폼 폭 유지(D3), 제목·카드·CTA 토큰은 적용 |
| EXC-INDEPENDENT | `/org/sample-org` | org_admin | 1440 | 272 | 280 | -8 | AppShell 밖 독립 화면(사이드바 없음) — 편입은 화면 구성 변경이라 제외, 읽기·폼 폭 유지(D3), 제목·카드·CTA 토큰은 적용 |
| EXC-INDEPENDENT | `/org/search` | org_admin | 1440 | 272 | 280 | -8 | AppShell 밖 독립 화면(사이드바 없음) — 편입은 화면 구성 변경이라 제외, 읽기·폼 폭 유지(D3), 제목·카드·CTA 토큰은 적용 |
| EXC-READING | `/profile/professional` | org_admin | 1440 | 504 | 280 | 224 | 읽기·폼 폭 672px 중앙 정렬 유지(D3), 셸 시작선 280=홈 280 |
| EXC-READING | `/reports/sample-report` | org_admin | 1440 | 392 | 280 | 112 | 읽기·폼 폭 896px 중앙 정렬 유지(D3), 셸 시작선 280=홈 280 |
| EXC-READING | `/reports` | org_admin | 1440 | 489.28125 | 280 | 209.28125 | 읽기·폼 폭 120px 중앙 정렬 유지(D3), 셸 시작선 280=홈 280 |
| EXC-INDEPENDENT | `/sessions/new` | org_admin | 1440 | 0 | 280 | -280 | 세션 생성 풀스크린 폼 — 독립 레이아웃 |
| EXC-INDEPENDENT | `/sessions/sample-session/class-report` | org_admin | 1440 | 352 | 280 | 72 | 문서형 리포트 — 읽기 폭 유지(D3), 모바일 좌우 16은 통일 |
| EXC-INDEPENDENT | `/sessions/sample-session/live` | org_admin | 1440 | 104 | 280 | -176 | 수업 진행·몰입 플레이어·기록 화면 — 몰입 화면 제외(D1) |
| OUT | `/sessions/sample-session/player` | org_admin | 1440 | - | - | - | 몰입 플레이어 제외(D1) |
| EXC-INDEPENDENT | `/sessions/sample-session/summary` | org_admin | 1440 | 352 | 280 | 72 | 문서형 리포트 — 읽기 폭 유지(D3), 모바일 좌우 16은 통일 |
| FAIL | `/sessions/sample-session` | org_admin | 1440 | 360 | 280 | 80 |  |
| FAIL | `/sessions` | org_admin | 1440 | 264 | 280 | -16 |  |
| EXC-READING | `/settings` | org_admin | 1440 | 504 | 280 | 224 | 읽기·폼 폭 672px 중앙 정렬 유지(D3), 셸 시작선 280=홈 280 |
| EXC-INDEPENDENT | `/chat` | org_admin | 390 | 0 | 16 | -16 | 채팅 대화면 분할 구조(spec 비범위·D3) |
| EXC-INDEPENDENT | `/classes/new` | org_admin | 390 | 0 | 16 | -16 | 클래스 편성 마법사 — 독립 풀스크린 레이아웃 |
| EXC-INDEPENDENT | `/classes/now` | org_admin | 390 | 0 | 16 | -16 | 즉시 수업 대기실 — 몰입 진입 전 공간 배치 유지(D1) |
| OUT | `/clients/invite` | org_admin | 390 | - | - | - | 권한 안내 상태 화면 — 정상 페이지 측정 아님 |
| EXC-INDEPENDENT | `/membership-invite?token=synthetic-invite-token` | org_admin | 390 | 0 | 16 | -16 | 공개 초대 수락 — 셸 없는 독립 레이아웃 |
| OUT | `/membership-invite` | org_admin | 390 | - | - | - | 토큰 미제공 안내 상태 화면 — 정상 페이지 측정 아님 |
| EXC-INDEPENDENT | `/sessions/new` | org_admin | 390 | 0 | 16 | -16 | 세션 생성 풀스크린 폼 — 독립 레이아웃 |
| EXC-INDEPENDENT | `/sessions/sample-session/class-report` | org_admin | 390 | 12 | 16 | -4 | 문서형 리포트 — 읽기 폭 유지(D3), 모바일 좌우 16은 통일 |
| OUT | `/sessions/sample-session/player` | org_admin | 390 | - | - | - | 몰입 플레이어 제외(D1) |
| EXC-INDEPENDENT | `/sessions/sample-session/summary` | org_admin | 390 | 12 | 16 | -4 | 문서형 리포트 — 읽기 폭 유지(D3), 모바일 좌우 16은 통일 |
| EXC-READING | `/admin/reviews/credential/sample-review` | platform_admin | 1440 | 328 | 280 | 48 | 읽기·폼 폭 1024px 중앙 정렬 유지(D3), 셸 시작선 280=홈 280 |
| EXC-INDEPENDENT | `/chat/sample-room` | platform_admin | 1440 | 620 | 280 | 340 | 채팅 대화면 분할 구조(spec 비범위·D3) |
| EXC-INDEPENDENT | `/chat` | platform_admin | 1440 | 240 | 280 | -40 | 채팅 대화면 분할 구조(spec 비범위·D3) |
| EXC-READING | `/notifications` | platform_admin | 1440 | 504 | 280 | 224 | 읽기·폼 폭 672px 중앙 정렬 유지(D3), 셸 시작선 280=홈 280 |
| EXC-INDEPENDENT | `/org/requests` | platform_admin | 1440 | 336 | 280 | 56 | AppShell 밖 독립 화면(사이드바 없음) — 편입은 화면 구성 변경이라 제외, 읽기·폼 폭 유지(D3), 제목·카드·CTA 토큰은 적용 |
| EXC-READING | `/settings` | platform_admin | 1440 | 504 | 280 | 224 | 읽기·폼 폭 672px 중앙 정렬 유지(D3), 셸 시작선 280=홈 280 |
| EXC-INDEPENDENT | `/chat` | platform_admin | 390 | 0 | 16 | -16 | 채팅 대화면 분할 구조(spec 비범위·D3) |
| EXC-INDEPENDENT | `/account-deletion` | public | 1440 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| OUT | `/audit-unknown` | public | 1440 | - | - | - | 의도된 404 안내 |
| EXC-INDEPENDENT | `/class-members/sample-class` | public | 1440 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/class/sample-session/enter` | public | 1440 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/crisis-help` | public | 1440 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/forgot-password` | public | 1440 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/invite/sample-token` | public | 1440 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/join` | public | 1440 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/` | public | 1440 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/login/client` | public | 1440 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/login` | public | 1440 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/measurement-guide` | public | 1440 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/o/SAMPLE` | public | 1440 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/org/register` | public | 1440 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/privacy` | public | 1440 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/register/audit-unknown` | public | 1440 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/register/client` | public | 1440 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/register/counselor` | public | 1440 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/register/organization` | public | 1440 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/register` | public | 1440 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/report-view?token=synthetic-view-token` | public | 1440 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| OUT | `/report-view` | public | 1440 | - | - | - | 토큰 미제공 안내 상태 화면 — 정상 페이지 측정 아님 |
| EXC-INDEPENDENT | `/reports/sample` | public | 1440 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/reset-password?token=synthetic-token` | public | 1440 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/reset-password` | public | 1440 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/role-redirect` | public | 1440 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/set-password?token=synthetic-token` | public | 1440 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/set-password` | public | 1440 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/terms` | public | 1440 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/account-deletion` | public | 390 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| OUT | `/audit-unknown` | public | 390 | - | - | - | 의도된 404 안내 |
| EXC-INDEPENDENT | `/class-members/sample-class` | public | 390 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/class/sample-session/enter` | public | 390 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/crisis-help` | public | 390 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/forgot-password` | public | 390 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/invite/sample-token` | public | 390 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/join` | public | 390 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/` | public | 390 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/login/client` | public | 390 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/login` | public | 390 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/measurement-guide` | public | 390 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/o/SAMPLE` | public | 390 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/org/register` | public | 390 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/privacy` | public | 390 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/register/audit-unknown` | public | 390 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/register/client` | public | 390 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/register/counselor` | public | 390 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/register/organization` | public | 390 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/register` | public | 390 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/report-view?token=synthetic-view-token` | public | 390 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| OUT | `/report-view` | public | 390 | - | - | - | 토큰 미제공 안내 상태 화면 — 정상 페이지 측정 아님 |
| EXC-INDEPENDENT | `/reports/sample` | public | 390 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/reset-password?token=synthetic-token` | public | 390 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/reset-password` | public | 390 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/role-redirect` | public | 390 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/set-password?token=synthetic-token` | public | 390 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/set-password` | public | 390 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
| EXC-INDEPENDENT | `/terms` | public | 390 | - | - | - | 공개(비로그인) 독립 레이아웃 — 홈 기준 없음, 읽기 폭 유지(D3)·공통 색/글꼴/컨트롤 토큰 적용 |
