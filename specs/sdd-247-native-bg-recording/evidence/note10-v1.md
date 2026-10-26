# SDD-247 Note10 실기기 검증 v1 — 판정: 보류 (로그인 단계에서 중단)

## 판정
- 합격/불합격 판정 불가. 상담사 로그인이 401로 실패하여 지시에 따라 1회 시도 후 중단.
- 녹음·청크·DB 조회 단계는 수행하지 않음(청크 표·logcat 요약 없음).

## 시각별 절차 (KST 2026-10-26)
1. 기기 R3CMA0C3Y4T 연결 확인(adb), 배터리 100%/USB, 화면 잠금 상태 → 깨우기+스와이프로 해제(잠금 PIN 없음).
2. 앱 com.looxidlabs.mindbreeze2.dev 실행(pid 31058), WebView CDP(webview_devtools_remote → adb forward 9333) 연결 성공. 초기 화면 https://localhost/login.
3. 상담사 탭에서 counselor@test.com + loadtest_mb2.py 의 비밀번호로 로그인 1회 시도.
   - 결과: `POST https://api.mindbreeze.looxidlabs.com/api/v1/auth/login` → **401**("이메일 또는 비밀번호가 일치하지 않습니다"). 직전 `auth/refresh` 도 401(저장된 세션 없음).
4. 계정 잠금 방지를 위해 재시도하지 않고 중단. 배터리 unplug·deviceidle force 등 기기 설정은 변경하지 않았으므로 원복 대상 없음. 클래스 생성/시작 없음.

## 발견 사항 / 가설
- APK 가 호출하는 API 호스트가 `api.mindbreeze.looxidlabs.com` 이다. 이 호스트가 dev 서버(18.183.86.88, dev DB)인지 확인 필요. 다른 환경(prod 등)을 가리키면 dev 시험계정이 존재하지 않아 401 이 되는 것이 자연스럽다. 빌드 시 VITE_API_BASE 등 dev 환경 변수 주입 누락 가능성(파일:줄은 frontend 빌드 설정/capacitor env 확인 필요 — 미확인).
- 그렇지 않다면 loadtest_mb2.py 와 dev DB 의 counselor@test.com 비밀번호 불일치.
- 서버 저장 코드(origin/develop `audio_service.save_chunk`)는 확인함: 바이트를 형식 검사 없이 `.bin` 으로 저장, (session_id, chunk_index) 멱등. 업로드 연속성 시험 자체는 가능하다.

## 다음 단계 제안
- 앱의 API 베이스가 dev 인지 확인(CDP 로 번들 설정 확인, 읽기 전용) 후 계정 유효성은 dev DB 읽기 조회(건수·존재 여부)로 확인.
- 해결 후 본 시험 재개: 로그인 → 대면 클래스 → 동의·녹음 → 화면 끔 5분+ → 복귀 → 종료 → 청크 조회/ffprobe.

## 원복
- 기기 설정 변경 없음(화면 해제·앱 실행만). adb forward 9333 은 제거함.
