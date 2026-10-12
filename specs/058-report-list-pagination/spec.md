# SDD-058 — 리포트 목록 페이지네이션

> 리포트가 많아질 때를 대비해 목록 조회에 페이지네이션을 추가한다.

## 1. 배경
- `list_reports`가 전체 리포트를 한 번에 반환 → 리포트 증가 시 성능 저하.
- 프론트도 전체 로드 후 클라이언트 필터링.

## 2. 구현 범위
### BE (codex)
- `list_reports`에 offset/limit + total 반환 (하위호환: 기존 무페이지네이션 호출은 유지)
- 쿼리 파라미터: page/limit (기본 전체 또는 limit)

### FE (cursor)
- ReportListPage에 페이지네이션 UI (이전/다음, 페이지 번호)
- limit 단위 로드

## 3. 완료 기준
- 페이지네이션 동작, total 정확
- BE pytest, FE build 0 error
