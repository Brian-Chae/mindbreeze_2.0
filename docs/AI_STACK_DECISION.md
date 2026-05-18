# MIND BREEZE 2.0 — AI 스택 결정서 (1페이지)

| 항목 | 값 |
|------|-----|
| **버전** | `v1.0.0` |
| **상태** | `Proposed` — 개발 착수 전 Brian 승인(§18) 권장 |
| **작성** | 2026-05-18 |
| **근거 문서** | `MIND_BREEZE_2.0_종합_기획.md` v1.2.0 · `MIND_BREEZE_2.0_기능명세서.md` v1.1.0 |

> 본 문서는 STT·화자 분리·문서 OCR·상담 요약·자격 검증에 쓰는 **외부 AI 벤더·모델·폴백**을 한 줄로 고정한다. 구현·비용 산정·SLA 검증의 단일 기준이다.

---

## 1. 결정 요약

| 용도 | 1차 (Primary) | 2차 (Fallback) | 비고 |
|------|---------------|----------------|------|
| **세션 STT + 화자 분리** | Google **Gemini** (Audio 멀티모달, 1회 호출) | OpenAI **Whisper** + **pyannote.audio** (분리 파이프라인) | 한국어 1:1 상담, NFR-03 목표 5분/30분 |
| **상담 기록지·리포트 요약** | **Claude** (Anthropic) | **Gemini** (동일 프롬프트) | 세션 유형별 템플릿, §18 승인 후 발송 문구 |
| **증빙 OCR·문서 분류·위변조 휴리스틱** | Google **Gemini** (Vision) | 수동 어드민 검토(F11) | F3.5 Celery 비동기 |
| **자격 판정·반려 사유 초안** | 규칙 엔진 + Gemini 텍스트 | 어드민 최종 판정 | `auto_approve` / `needs_review` / `reject` |
| **EEG 지표 분석** | **Looxid Labs SDK** (온프레미스/전용) | — | 외부 LLM 미사용 |

**공통 정책 (F14.5):** 식별자 마스킹, 벤더 **no-train** 옵션, 호출 메타(요청 ID·시간·크기)만 PG 저장.

---

## 2. 파이프라인별 상세

### 2.1 세션 음성 → 기록지 (F7)

```
[브라우저 녹음] → S3 청크 병합
       ↓
[Celery] Gemini Audio: STT + speaker segments (1차)
       ↓ (실패·타임아웃·품질 미달)
[Celery] Whisper STT → pyannote diarization → segments 병합 (2차)
       ↓
[Celery] Claude: 세션 유형별 기록지·요약 초안
       ↓ (Claude 장애)
[Celery] Gemini: 동일 템플릿 요약 (2차)
       ↓
[상담사 편집·승인] → 리포트(F8) → §18 승인 후 발송
```

| 단계 | SLA 목표 | 실패 시 UX |
|------|----------|------------|
| STT+화자 | NFR-03: 30분 음성 **&lt; 5분** | "처리 중", 폴백 파이프라인 자동 재시도 1회 |
| 요약 | NFR-04: **&lt; 2분** | 수동 기록 모드 유지, 초안 없이 저장 가능 |

**품질 기준 (QA):** 화자 라벨 정확도 ≥80% (한국어 1:1, 샘플 세트 20건으로 MVP1 말미 검증).

### 2.2 자격·센터 증빙 (F2.2, F3.5)

```
[업로드] → S3 SSE-KMS
       ↓
[Celery] Gemini Vision: OCR + 문서 유형 분류 + risk_score 휴리스틱
       ↓
[동기 API] 국세청 사업자 상태 (센터만, 식별자 최소)
       ↓
[규칙 엔진] 교차 일관성 → verdict
       ↓
needs_review → F11 어드민 큐 | reject → LLM 사유 초안(Gemini)
```

| verdict | 조건 (요지) |
|---------|-------------|
| `auto_approve` | 공공 API 일치 + risk&lt;0.15 + 필드 일관성 |
| `needs_review` | 중간 임계값 또는 API 미연동 |
| `reject` | 위변조·명백 불일치 |

모델 응답 **5초 초과** 시 큐 적재, UI는 "검토 중"(F3.5).

---

## 3. 벤더 선정 이유 (한 줄)

| 선택 | 이유 |
|------|------|
| Gemini Audio (STT) | STT+diarization **단일 API**로 파이프라인 단순화·레이턴시. 기능명세서 F7.2와 정합 |
| Whisper+pyannote (폴백) | 한국어·장애 시 **검증된 오픈 조합**, 종합기획 §9 아카이브와 호환 |
| Claude (요약) | 장문 상담 요약·톤 제어 품질, "AI가 기록·사람이 결정" 원칙에 부합 |
| Gemini Vision (OCR) | 멀티모달 증빙·F3.5와 동일 스택으로 운영 단순화 |

---

## 4. 비용·보안 체크리스트 (착수 전)

- [ ] Gemini·Claude·Whisper **월간 예상 토큰/분** 산정 (세션 30분 × 월 N건)
- [ ] DPA·no-train·리전(한국/해외) 계약 확인
- [ ] POC: 한국어 상담 샘플 5건 STT+요약 E2E (MVP1 Sprint 0~1)
- [ ] pyannote 모델 라이선스·GPU 워커 필요 여부

---

## 5. 오픈 이슈 해소

| 기존 오픈 이슈 | 본 결정서 |
|----------------|-----------|
| STT/LLM 벤더 미정 (종합 §17-4) | **본 문서 v1.0.0로 1차 확정** (Proposed) |

변경 시 본 문서 버전을 올리고 `MIND_BREEZE_2.0_기능명세서.md` F7.2·F3.5 문구를 동기화한다.

---

**문서 식별:** `mindbreeze-2.0-ai-stack-decision` · `v1.0.0`
