# [SDD-190] — Verification (Pre-Implementation)

## Test Scenarios
### TS1: 토큰 등록
`POST /devices` → 200, 같은 토큰 재호출은 upsert(행 1개, last_seen 갱신), 다른 사용자가 같은 토큰으로 등록하면 소유자가 이전됨(기기 소유 변경). 잘못된 platform 422.
### TS2: 토큰 해지
본인 토큰 `DELETE` → 204 후 발송 대상 제외. 타인 토큰 → 404. 비로그인 401.
### TS3: 푸시 발송(모킹)
push pending 행 + 사용자 활성 토큰 2개 → cron → FCM 호출 2회, 행 `sent`. payload에 이름·상담 내용 없음, data에 deeplink·message_id.
### TS4: 실패·재시도
FCM 500 → attempts 증가, available_at 백오프, 3회 실패 시 `failed`. UNREGISTERED 응답 → 해당 토큰 revoke, 나머지 토큰은 계속 발송.
### TS5: 토큰 없음·만료
토큰 없는 사용자 → `skipped`. 24시간 초과 pending → `expired`.
### TS6: 자격증명 미설정
환경변수 없음 → 발송 시도 없음, 행 `pending` 유지, 예외 없음, 로그 1줄.
### TS7: 소비 충돌 없음
email/ws 소비 cron이 push 행을 건드리지 않음, push cron이 email/ws 행을 건드리지 않음.
### TS8: 프론트 — 웹 no-op
`isNativeApp()=false`에서 푸시 등록 훅·BLE 어댑터 선택이 아무 네이티브 호출도 하지 않고 기존 `useBand` 웹 경로 유지.
### TS9: 프론트 — 푸시 등록 흐름(모킹)
네이티브 가정: 권한 허용 → 토큰 수신 → `/devices` 호출. 권한 거부 시 호출 없음·오류 없음. 로그아웃 시 해지 호출.
### TS10: 프론트 — 딥링크
푸시 탭 데이터 `/app/ai`(내담자)·`/agent`(상담사) → 해당 라우트 이동. 허용 외 경로/스킴은 무시.
### TS11: BLE 어댑터
어댑터 인터페이스 단위 테스트(웹 구현은 기존 동작 위임, 네이티브 구현은 플러그인 모킹으로 scan→connect→notify→disconnect→재연결 흐름). 참조 저장소와 동일한 플러그인·UUID·권한 사용.
### TS12: 빌드·동기화
`npm run build` 통과, `capacitor.config.ts` appId/webDir 확인, 가능하면 `npx cap sync android` 오류 없음. iOS 추가 실패 시 사유 문서화.
### TS13: 회귀
`alembic heads` 단일 `e036a0000038`(189 병합 후), 백엔드 전체 pytest 신규 실패 0, 프론트 기존 실패 외 신규 0.

## Edge Cases
- [ ] 같은 사용자 다기기, 동일 토큰 다계정
- [ ] 푸시 payload 크기·한글 인코딩
- [ ] 앱 포그라운드 수신 시 중복 인앱 알림 방지
- [ ] BLE 권한 거부/블루투스 꺼짐 안내 UX
- [ ] 웹 미지원 브라우저 안내 유지

## Security Review
- [ ] 서비스 계정 키·토큰 값 로그/응답 출력 금지, 값 접두사·길이만
- [ ] 토큰 API 소유자 검증
- [ ] 딥링크 화이트리스트(앱 내 경로만)
- [ ] 푸시 본문 비식별
- [ ] 네이티브 설정에 비밀값 하드코딩 금지(`google-services.json` 등 자격증명 파일은 커밋하지 않음, .gitignore)
