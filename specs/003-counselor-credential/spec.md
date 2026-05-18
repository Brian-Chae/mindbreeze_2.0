# Spec: F3 상담사 자격 증명

- **Sprint ID**: 003-counselor-credential
- **작성일**: 2026-05-19
- **대상 영역**: F3.1 ~ F3.3, F3.6 (기능명세서 §178~240)
- **개발 단계**: MVP1 / **우선순위**: P0
- **제외**: F3.4(만료 관리, MVP3), F3.5(AI 검증 파이프라인, 별도 스프린트)
- **현재 코드 상태**:
  - `backend/app/models/credential.py` — Credential, VerificationAudit 모델 존재
  - User.verified_tier 컬럼 존재 (unverified/email/verified)
  - 자격 증빙 API 전무

---

## 공통 규칙

- 모든 API `/api/v1`, JWT 인증, `get_current_user`
- 오류: `{"detail": "한국어 메시지"}`
- 파일 업로드: 로컬 `uploads/` 디렉토리 (운영 전환 시 S3)
- AI 파이프라인: placeholder — 업로드 시 status="pending" 저장

---

## F3.1 자격 증빙 업로드

### 액터
Counselor

### 메인 플로우
1. `POST /credentials/upload` — multipart/form-data: `file` + `type`(id_card/license/diploma/career) + `expires_at`(선택)
2. 파일 저장 → `uploads/{user_id}/{credential_id}.{ext}`
3. `Credential` 레코드 생성 (status=pending)
4. 제한: 파일 ≤10MB, 1인당 최대 10건, id_card는 1건만

### 예외 처리
| 케이스 | 응답 |
|---|---|
| 파일 크기 초과 | 413 `파일 크기는 10MB 이하여야 합니다` |
| 최대 개수 초과 | 409 `최대 10개까지 업로드 가능합니다` |
| id_card 중복 | 409 `신분증은 1개만 등록 가능합니다` |
| 미지원 파일 형식 | 422 `PDF, JPG, PNG 파일만 업로드 가능합니다` |

### API
- `POST /api/v1/credentials/upload` — multipart `{ file, type, expires_at? }` → `CredentialResponse`
- `GET /api/v1/credentials` — 내 증빙 목록
- `DELETE /api/v1/credentials/{id}` — 증빙 삭제 (pending 상태만)

### 수락 기준 (QA)
- [ ] 신분증 1건 + 자격증/학위/경력 1건 이상 업로드 가능
- [ ] 10MB 초과 파일 413
- [ ] id_card 2건째 업로드 시 409
- [ ] PDF/JPG/PNG 외 형식 422

---

## F3.2 인증 등급 산정

### 등급 체계
| 등급 | 조건 | 비고 |
|---|---|---|
| `verified` | id_card 1건 + license/diploma/career 중 1건 이상 + status=approved | 현재 F3.5 placeholder → 수동 approved 처리 |
| `email` | 이메일 인증만 완료 | 가입 시 기본값 |
| `unverified` | 이메일 인증 미완료 | |

*F3.5 AI 파이프라인 구현 전까지는 수동으로 `PUT /admin/credentials/{id}` 호출하여 status=approved 설정*

### 규칙
- `verified_tier`는 가장 높은 조건 충족 시 자동 갱신
- `verified` 미만 → 내담자 매칭에서 제외 (F1.4에서 이미 구현)

### 수락 기준 (QA)
- [ ] id_card approved + license approved → verified_tier="verified"
- [ ] 증빙 부족 시 verified_tier 유지

---

## F3.3 인증 뱃지 표시

- `UserResponse`에 `verified_tier` 포함 (이미 구현)
- 증빙 목록 API에 `status` 포함

---

## F3.6 본인 자격 대시보드

- `GET /credentials` — 내 모든 증빙 + 등급 + 상태 한눈에 확인
- 부족한 증빙 안내 (예: "신분증을 업로드해주세요")

### 수락 기준 (QA)
- [ ] 업로드한 증빙 목록 정상 표시
- [ ] verified_tier 표시
- [ ] 미완료 항목 안내

---

## API 요약

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/credentials/upload` | 증빙 업로드 |
| GET | `/credentials` | 내 증빙 목록 + 등급 요약 |
| DELETE | `/credentials/{id}` | 증빙 삭제 |
| PUT | `/admin/credentials/{id}` | 관리자 검증 승인/반려 (placeholder) |
