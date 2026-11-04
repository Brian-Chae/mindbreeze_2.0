# SDD-292 — iOS dev 전용 앱 분리 (별도 번들 ID·TestFlight)

- 상태: 구현·검증 완료(리뷰 대기)
- 브랜치: `sdd/292-ios-dev-app`
- 작성일: 2026-11-05

## 목적
- 운영 앱(`com.looxidlabs.mindbreeze2`)과 한 폰에 나란히 설치되는 iOS dev 앱(`com.looxidlabs.mindbreeze2.dev`, 표시 이름 "MB Dev")을 만든다.
- Android `.dev` flavor와 같은 방식. dev API를 보고 TestFlight 별도 앱으로 배포 → 사이트 베타(운영)와 섞이지 않게 한다.

## 범위
- Xcode 빌드 구성 `Release-Dev`/`Debug-Dev` + 공유 scheme `App-Dev` (번들 ID·표시 이름·아이콘·Google URL 스킴 분리)
- 운영 구성(Debug/Release)의 산출물은 변하지 않는다 (번들 ID·표시 이름·URL 스킴 동일)
- `package.json` `ios:dev:*` 스크립트, dev 전용 plist 위치 규칙(값 커밋 금지)
- 빌드·업로드 스크립트 `~/.hermes/share/app-build/ios-dev-build.sh`
- ASC 앱 레코드 생성 입력값 문서 `asc-record.md`

## 비범위
- Capacitor `appId` 변경 (Android 공용 → 불변)
- ASC 레코드 생성, Firebase 콘솔, APNs 키 업로드, Apple 개발자 포털 작업 (대표 작업)
- 푸시·PR·배포·스토어 제출
