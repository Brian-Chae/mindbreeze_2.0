# SDD-254 현장 운영 런북

## 사전(전날)
- [ ] `https://<운영웹>/beta` 를 iPhone·Android LTE 로 열어 각 버튼 확인(링크 비어 있으면 '준비 중' 표시)
- [ ] `beta.json`: android.apkUrl·sha256·versionCode, ios.testflightUrl·expiresAt 채워짐 (TestFlight 빌드 90일 만료일 기록)
- [ ] 운영 서버 정상, 클래스 코드 준비, 예비 설치 도우미 1인, 예비 충전기·핫스팟
- [ ] QR 인쇄(`node scripts/make-beta-qr.mjs <랜딩URL> <폴더>`), 실제 크기로 폰 3종 인식 확인

## 현장 안내(참여자)
- Android: QR → 앱 내려받기 → '출처를 알 수 없는 앱 허용'(이 출처만) → 설치 → 'Play 프로텍트' 경고 시 '그래도 설치' → 마이크·블루투스 허용
- iPhone: QR → TestFlight 앱 설치(없으면) → 초대 수락 → 설치 → 권한 허용
- 이후 로그인/가입 → 클래스 코드 입장

## 막히는 지점
| 증상 | 대응 |
|---|---|
| 삼성/브라우저별 설치 허용 화면 다름 | 도우미가 설정 → 앱 → 특별한 접근 → 출처를 알 수 없는 앱 안내 |
| 저장공간 부족 | 앱 용량 안내, 불필요 파일 삭제 |
| 회사 MDM·구형 OS | 웹(`/login`)으로 대체 참여 |
| TestFlight/Apple ID 없음 | Apple ID 생성 안내, 불가 시 웹 대체 |
| 현장 Wi-Fi 불안정 | LTE 사용, 핫스팟 |
| 구 APK 가 설치돼 있음 | 새 APK 열어 '업데이트'(서명 일치 시 덮어쓰기). 불가 시 삭제 후 재설치(로컬 데이터 손실 고지) |
| 설치는 됐는데 로그인 불가 | 약관 동의·계정 확인, 담당자 문의 |

## 갱신(새 빌드 게시)
1. 합격 빌드 → Play 내부 테스트 → 유니버설 APK 다운로드 → `scripts/beta-apk-prepare.py` 검수 → 업로드(승인) → `beta.json` 갱신 → `updateBannerEnabled=true`.
2. QR 은 그대로.
