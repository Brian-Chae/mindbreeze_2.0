# SDD-245 페이지 헤더 누락 보완 요약

- AppShell/ClientShell 정본을 PageHeader로 교체해 제품 페이지 파일 34개와 공용 회차 상세 뷰 1개, 소스 단위 35개에 적용했다. 역할·중첩 경로를 별도 집계한 실제 셸 헤더 표본은 170개다.
- 제목 22/700. 헤더 sm 44px, primary 진보라 pill, secondary 흰 배경·보라 1px 테두리 pill. DOM 순서 보조→주, 제목 대비 세로 중앙, 모바일 아래 행은 동일폭. 새 클래스=주/지금 바로 시작=보조. 문구·핸들러 유지.
- 리포트 영문 오버라인을 제거하고 리포트/클래스 필터를 공용 tab/field 토큰으로 연결했다. 선택 오버라인은 13px 이상을 보장한다.

## 전수 재측정

최종 final3 빌드, Chrome 합성 fixture 기준. 전체 manifest 109개, 역할별 162표본 × 2폭 = 324개, 중복·누락 0.

| 폭 | 전체 라우트·역할 표본 | 페이지 헤더 | 액션 있는 헤더 | 액션 버튼 | 불일치 |
|---|---:|---:|---:|---:|---:|
| 390 | 162 | 81 | 32 | 41 | 0 |
| 1440 | 162 | 89 | 32 | 41 | 0 |
| 합계 | 324 | 170 | 64 | 82 | 0 |

검사: 제목22/700·높이44·pill·배경·테두리·주최대1개·DOM순서·제목과 같은 행의 중심±1px·아래 행 동일폭. AppShell 헤더 측정 누락도 실패 처리했다. 390에서 8개 적은 이유는 기존 hideMobileTitle 모바일 채팅방 계약이며 새 예외가 아니다. 공개 독립 화면·리다이렉트·몰입 플레이어 등 대상 밖 표본도 제외 사유와 함께 전체 JSON에 보존했다.

- 실측: `header-measurements.json`
- 독립 판정: `assert-result.json`
- 전체 경로: `route-manifest.json`
- 빌드·소스·번들 SHA-256: `measurement-provenance.json`
- 소스별 이관·필터 감사: `header-inventory.md`

## 화면 증거

- `dashboard-390-compare.png`
- `classes-390-compare.png`
- `reports-390-compare.png`

각 화면 before/after 원본도 같은 디렉터리에 저장했다. 최종3 비교 캡처를 모두 직접 열어 확인했다. before는 구현 전 빌드의 제품 소스(9e6aae1a), after는 최종3 빌드다.

## 검증과 한계

집중 테스트 4파일 32건 통과. 전체 vitest/tsc/eslint/build, 원상복구·최종 diff, 커밋·PR·CI 결과는 감독 검증 후 아래에 기록한다. 실제 iPhone·dev 서버·실제 API/DB 검증과 머지·배포·메일 발송은 수행하지 않았다.

## 감독 최종 검증

- 전체 Vitest: 280파일 중 272통과/기존8실패, 3,052건 중 3,035통과/기존17실패. 신규 실패 0. 기존 실패 목록은 validation.json에 보존했다.
- `npx tsc --noEmit -p tsconfig.app.json`, `npx eslint src/`, `npm run build`: 모두 exit 0. 기존 번들 크기·동적 import 경고만 남았다.
- 독립 검사기를 최종324개 표본에 다시 실행하여 불일치0 확인. 감독도 최종 전후 비교 PNG3개를 직접 열어 확인했다.
- `specs/sdd-234-mobile-type-polish` 자동 생성물 원복, diff 0. node_modules 심볼릭 미추적/미커밋. `git diff --check` 통과.
- 소스 독립 리뷰에서 발견한 중요3건 모두 수정·재리뷰 완료(차단 결함 없음).
