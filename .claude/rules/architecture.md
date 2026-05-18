# 아키텍처 규칙

## Frontend (React + TypeScript)

- **SPA 구조**: Vite 기반. Next.js 사용하지 않음 (Web Bluetooth API + SPA 최적).
- **상태 관리**: TanStack Query(서버 상태) + Zustand(클라이언트 상태). Redux 금지.
- **라우팅**: React Router v6. 역할 기반 가드(전문가/내담자).
- **BLE**: Web Bluetooth API 직접 사용. `navigator.bluetooth.requestDevice()` → GATT 구독.
- **WebSocket**: Socket.IO 클라이언트. 실시간 EEG + 세션 상태.
- **차트**: Recharts (시계열) + D3.js (고급 시각화).

## Backend (FastAPI + Python)

- **API**: FastAPI + Pydantic v2. REST 원칙. `/api/v1/` 프리픽스.
- **비동기**: Celery + Redis. STT 변환, AI 요약, 리포트 생성은 모두 비동기 태스크.
- **WebSocket**: Socket.IO (python-socketio). 실시간 EEG 브로드캐스트.
- **인증**: JWT (OAuth2 패스워드 플로우). 역할 기반 접근 제어.
- **파일**: S3 프리사인드 URL. 직접 업로드/다운로드.

## Database (PostgreSQL + TimescaleDB)

- **OLTP**: PostgreSQL. 사용자, 세션, 기록, 리포트.
- **시계열**: TimescaleDB hypertable. EEG 레코드, 센서 Raw 데이터.
- **마이그레이션**: Alembic. 자동 생성 금지, 수동 리뷰 필수.

## 데이터 모델 핵심

- **User**: id, email, name, role(전문가/내담자), profile
- **Session**: id, type(임상/최면/명상), status, scheduled_at, duration, host_id
- **EEGRecord**: id, session_id, user_id, timestamp, raw_data, analysis_result — LINK BAND 착용 시에만 생성
- **SessionRecord**: id, session_id, transcript, ai_summary, markers[], counselor_notes
- **Report**: id, session_id, user_id, type(상담사/내담자), content, pdf_url

## 분리 원칙

- **Frontend ↔ Backend**: REST + WebSocket. 직접 DB 접근 금지.
- **동기 ↔ 비동기**: HTTP 요청은 200ms 이내 응답. 장기 작업은 Celery + 폴링/WebSocket.
- **필수 ↔ 선택**: LINK BAND 관련 기능은 항상 선택적. `opt-in` 플래그 필수.
