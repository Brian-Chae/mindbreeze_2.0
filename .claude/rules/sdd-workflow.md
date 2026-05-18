# SDD 워크플로우 규칙

## 핵심 원칙

QA List = Spec. QA 항목이 곧 테스트 케이스이자 기능의 수락 기준.

## 파이프라인 (Stage 1-6)

| Stage | 행위 | 산출물 | 진입 조건 | 퇴장 조건 |
|---|---|---|---|---|
| 1 | spec.md 작성 | `specs/<ts>/spec.md` | 없음 | QA 리스트 ≥3행, 범위 명확 |
| 2 | plan.md 작성 | `specs/<ts>/plan.md` | spec.md 완료 | 구현 전략 + 파일 목록 |
| 3 | tasks.md 작성 | `specs/<ts>/tasks.md` | plan.md 완료 | 체크박스 태스크 ≥3개 |
| 4 | 구현 | 소스 코드 | tasks.md 완료 | 모든 태스크 체크 |
| 5 | 코드 리뷰 | 리뷰 결과 | 구현 완료 | 보안·품질 통과 |
| 6 | 테스트 + 빌드 | 통과 리포트 | 리뷰 완료 | `npm test && npm run build` 통과 |

## 필수 규칙

1. **spec 없이 코딩 금지**: `specs/<ts>/spec.md`를 먼저 읽고 시작할 것.
2. **QA 우선**: spec.md 작성 시 반드시 QA 체크리스트 ≥3행 포함.
3. **LINK BAND 가드**: 모든 EEG 관련 코드는 `if (bandConnected)` 블록 내에서만 실행. 미연결 시에도 기능 동작해야 함.
4. **브라우저 감지**: Web Bluetooth API 사용 전 반드시 `navigator.bluetooth` 존재 확인. 미지원 시 안내 UX 표시.
5. **비동기 AI**: STT/LLM 호출은 반드시 Celery 태스크로 처리. HTTP 요청 내에서 동기 호출 금지.
6. **변경 최소화**: spec 범위를 벗어난 파일은 수정하지 말 것.
