# SDD-173 — 하(하) 프론트 14건 요약

## 구현 결과

14건 완료.

| 영역 | 변경 |
|---|---|
| 접근성 | 아이콘 aria-label·색대비 /70·role=status·aria-current |
| 폼/반응형/i18n | 전화번호 포맷·제출 갱신·w-full·role 한글 매핑 |
| 훅 | senderName 실변경 감지·단일 trigger·seenRef 소유권·once 정리·대기실 join·readiness 결속 |

## 검증

- `tsc --noEmit` 0 · build ✓ 9.74s · vitest **44/318**
