# SDD-244 B 리뷰 수정 감독 검증

- 서버 병합 기준: `6a1de353` (충돌 없음). `8fc42276`, `dc2babad`, `b40bca3f` 포함 확인.
- 원래 미커밋 리뷰 보고서는 보존하여 최종 커밋에 포함한다.

## 전체 기준선

`npx vitest run --config /tmp/sdd244-vitest.config.mts --reporter=json --outputFile=/tmp/sdd244-review-baseline.json`

- 2,904 passed / 17 failed / 2,921 tests. 실패 파일 8개.
- 실행 중 core 수정이 시작됐으므로 전체 소스의 불변 스냅샷 실행은 아니다. 아래 기존 실패 파일과 그 UI 의존 경로는 수정 전 실행했으며, 최종 결과와 테스트 이름 단위로 대조한다.
- fake-indexeddb는 기존 `/tmp/sdd244-test-deps` alias 사용. 서버·DB 실행 없음.

| 파일 | 실패 수 |
|---|---:|
| `agent-counselor-page.test.tsx` | 2 |
| `chat-message-deeplink.test.ts` | 2 |
| `org-counselor-management-browser.test.cjs` | 1 |
| `org-management-browser.test.cjs` | 2 |
| `report-modal-pdf.test.cjs` | 2 |
| `report-server-pdf.test.cjs` | 2 |
| `sdd220-native-release.test.ts` | 2 |
| `sdd234-a-mobile-home.test.tsx` | 4 |

## 서버 측 제한 — 수정하지 않음

- `biosignal_manifest_service.py:201-215`: lost feature/indices의 순번 구멍을 계속 missing에 추가한다. loss 선언 후에도 pending_upload가 남을 수 있다.
- 같은 파일 `225-231`: 유실 feature를 참조한 indices의 unresolved 참조도 loss 선언을 제외하지 않는다.
- 같은 파일 `303-319`: presign 전 로컬 유실 산출물은 DB 행이 없어 공개 manifest의 availability=lost 목록에서 빠진다.
- 검증 수준: 계약·서버 정적 대조, 독립 검증자 교차 확인. 순수 `_covered([], 0)` 추출 실행 결과 `[(0, 0)]`. 서버·DB·스토리지 통합 실행 결과가 아니다.

## 최종 검증

- 구현자 focused: 17파일 / 261 passed / 0 failed. 감독이 로그·diff 직접 확인.
- 감독 `npx tsc --noEmit -p tsconfig.app.json`: 최종 경계 수정 후 종료 0.
- 감독 `npm run build`: 최초 및 최종 경계 수정 후 모두 종료 0. 기존 청크 크기·dynamic import 경고만 존재.
- 최초 전체 확인: 2,928 passed / 17 failed / 2,945 tests. 기준선과 실패 파일·테스트 이름 집합이 동일(추가/해소 0). 최종 경계 수정 2건 포함 재실행은 **2,930 passed / 17 failed / 2,947 tests**, 실패 파일 8개·테스트 이름 집합이 기준선과 동일. JSON `/tmp/sdd244-review-final-confirmed.json`.
- 독립 코드 리뷰에서 빠른 동일 scope remount의 lease 경합과 렌더/effect 사이 모델 캐시 변경 경합을 발견. 구현자가 각각 RED 후 수정했고 재리뷰에서 두 건 해소, 해당 수정 범위 신규 결함 없음.
- 실제 FE runtime에서 생성한 raw/algorithm/raw_derived/feature/normalization/indices 6종 메타와 bytes 및 close intent를 추출해 서버 순수 DTO에 전달. meta schema, 본문 DTO(해당 종류), SHA-256, 압축 전 hash, size 모두 PASS. `.env` open·socket.connect·sqlite3.connect를 audit hook으로 차단. 서버·DB 통합 검증이 아니다.
- H06 상담사 화면은 본인 이완도 칩만 표시하므로 해당 값만 displayed, 나머지 5개 not_rendered. 회원 화면도 status sheet/hero/netDown에 따라 실제 표시 지표를 구분한다.
- 작업 후 backend diff 0(서버 브랜치 병합 기준), SDD-234 자동 생성 산출물은 전체 테스트 종료 후 `git checkout -- specs/sdd-234-mobile-type-polish`로 원복하여 커밋 제외한다.
