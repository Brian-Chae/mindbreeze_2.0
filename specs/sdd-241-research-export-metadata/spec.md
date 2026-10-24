# SDD-241 — 연구용 비식별 사본 메타데이터 보강

- 상태: **Brian 확정 결정 반영 · 구현 승인(2026-10-24 사용자 작업 지시)**
- 브랜치: `sdd/241-research-export-metadata`
- 최초 스펙: `599e06aa` (미승인 제안 및 조사 이력은 해당 커밋 참조)

## 1. 목적과 경계

연구 동의한 EEG 연구 사본의 해석에 필요한 인구학·측정·프로그램·진행자 메타데이터를 보강한다.
SDD-238 A안(연구 사본 무기한 분리 보관, 서비스 원본 90일 정책)은 유지한다.
참여자는 HMAC 가명 식별값을 쓰고 실명·이메일·전화·생년월일의 일자·원본 UUID·자유기입 제목/메모·녹음은 반출하지 않는다.
진행자는 아래 확정 결정에 따라 실명과 계정 ID를 포함하므로 사본 전체가 익명자료라는 보장은 하지 않는다.

## 2. Brian 확정 결정 (10/24) — 원문

| 번호 | 확정 결정 |
|---|---|
| 1 | 생년월일: 연·월까지만(birth_year_month 유지, 일자 제외). |
| 2 | 측정 일시: 시작·종료 시각을 정확하게 포함(UTC ISO8601 절대시각 + KST 환산 컬럼). 세션 단위와, 가능하면 참여자별 실제 측정 시작·종료(EEG raw chunk 최초/최종 시각 등 실제 데이터 근거). 근거 없으면 null + 사유. |
| 3 | 상담사/지도사: 가명이 아니라 실명 + 실제 계정 ID(user id) + 역할(상담사/지도사/기관관리자 등) 포함. 1:1은 담당 상담사, 클래스는 진행자(공동 진행자 있으면 전부). |
| 4 | 측정 프로그램 세부: spec 권장안(유형·회차·운영 정보 등 DB에 실제 있는 구조화 필드) 포함. |

## 3. 데이터 계약

- schema `2.0`, 기존 4개 Parquet에 `facilitators.parquet` 추가. 허용 필드 목록 해시와 파일별 sha256를 manifest에 기록한다.
- sessions: 기존 type/participant_mode/location_type/linkband_mode/duration_min 유지. 시작·종료 UTC/KST 및 결측 사유, class_pseudo/seq/session_kind, 클래스 schedule_mode/planned_session_count/default_duration_min 추가. 제목·설명·custom_type_name·주소·규칙 JSON은 제외한다.
- subjects: gender/birth_year_month 유지. raw chunk의 start_ms/end_ms로 개인 시작·종료 UTC/KST와 원천/결측 사유 추가. feature만으로 종료를 추정하거나 예약·입장·업로드 시각을 측정 시각으로 대체하지 않는다.
- 시각 원천: sessions.started_at/ended_at; EEG raw는 `useEegRawUpload.ts`가 ISO startedAt/endedAt을 epoch ms로 업로드한다. 세션 구간과 타당한 epoch, 유한값·순서를 검증한다. 유효한 raw 근거가 없거나 시계가 불명확하면 null + 사유. 장비 물리 시계 정확성을 보장하지 않는다.
- facilitators: session_pseudo, user_id, real_name, account_role, session_role. 실제 회차 host와 해당 회차 범위·추가/제거 기간이 겹치는 공동 진행자를 포함. 중도·종료 후 제거된 관계도 기간 근거가 있으면 포함하며, 제거 시각 미상/회차 전 제거/모순된 구간은 제외한다. 클래스 강사진 전체를 실제 출석 증빙처럼 표현하지 않고 관계 근거를 manifest에 명시한다. 현재 계정 역할/이름의 스냅샷이며 당시 값으로 소급 보장하지 않는다.
- 허용 enum 검증: 기존 세션 enum, 성별, session_kind/schedule_mode, 진행자 계정 역할/회차 역할. 미지 값은 업로드 전에 실패.
- `_scan_strings`는 참여자 이름·연락처와 자유기입 제목/메모 금지를 유지한다. 진행자 실명은 facilitators.real_name 셀만 예외로 하고 연락처 패턴 금지는 유지한다. 진행자 실명과 참여자 이름이 충돌하면 참여자 보호 우선으로 실패한다.
- revision content_hash에 schema/허용목록/동의 범위/세션·개인 시각·프로그램·진행자·raw 메타·payload 해시를 포함한다. 내용 변경 탐지는 재반출 권한과 별개다.

## 4. 동의 범위와 법적 위험

- 확장 범위는 명시적으로 새 연구 고지 `r5-2`에 동의했고 동의 이후 시작한 회차에만 적용한다. 미전달/미확인/구버전을 새 동의로 간주하지 않는다.
- 구버전 pending은 기존 범위 메타데이터만 반출한다. 혼합 회차는 동의 범위별 session/participant 가명 namespace와 session 행을 분리한다. 구동의 행에서 새 메타데이터로 조인할 수 없어야 한다. exported/acked 자동 재반출 없음.
- 기존 가입·클래스 기본 동의의 버전이 불명확한 상속은 r5-2로 승격하지 않는다. 새 항목은 새 고지 확인 이후 회차에만 적용한다.
- 개인정보방침과 참여자 연구 고지를 실제 계약과 맞춘다. 생년월과 HMAC을 복호화 가능한 이름 암호문처럼 설명하지 않는다.
- **진행자 본인 동의/그 밖의 적법한 이용 근거 및 외부 제공 근거는 구현 승인과 별개이며 아직 확인되지 않았다.** 참여자가 진행자를 대신해 동의할 수 없다. 상담사 고지 초안만 작성하고 신규 동의 UI·동의 증빙 모델은 구현하지 않는다. 실제 확장 반출 전에 법적 근거 및 운영 승인이 필요하다는 잔여 위험을 summary/PR에 명시한다.
- 정확한 일시·프로그램·진행자 실명과 인구학의 결합으로 재식별 위험이 커진다. 비밀키 분리·접근 통제·철회 처리 정책을 유지한다. 신규 진행자 철회 UI/처리 체계는 이번 범위 밖이고 미해결 위험이다.
- 기존 법령 조사와 상세 대안은 최초 스펙 `599e06aa` §4 참조. 이 구현은 법적 적합성 인증이 아니다.

## 5. 구현·검증 범위

spec/plan/verify를 먼저 커밋한 뒤 TDD로 구현한다. 새 값·결측·UTC/KST·참여자 PII·동의 혼합·enum·revision·manifest 해시·기존 철회/ack 계약을 검증한다.
관련 pytest, 백엔드 전체 회귀, 프론트 관련 vitest를 실행하고 결과·기존 실패·한계를 summary에 남긴다.
서버·DB·.env 접근, 실데이터 삭제, 메일, 머지·develop push·배포 금지. 로컬 SQLite 인메모리·저장소 더블로만 검증한다.
한글 구현 커밋을 작업 브랜치에 push하고 develop 대상 PR을 생성한다.
