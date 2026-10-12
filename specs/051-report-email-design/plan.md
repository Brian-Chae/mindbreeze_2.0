# SDD-051 구현 계획

- 발송 메일은 table 기반 인라인 CSS로 브랜드, 인사말, 안내, 보라색 CTA, 7일 만료 및 개인 링크 안내를 구성한다. 텍스트 본문과 발송 계약을 유지한다.
- 열람 페이지는 크림색 커버, 인사이트, 7개 EEG 지표 카드, 푸터로 구성한다. 수치는 접힌 details 안에서만 제공하고 임의의 등급이나 건강 해석을 만들지 않는다. null은 측정 정보 없음으로 표시한다.
- 모든 동적 문자열을 escape하고 기존 JWT·참가자·승인 상태 검증을 유지한다.
- API의 CSP에 style-src 'unsafe-inline'을 추가해 인라인 CSS를 허용한다. default-src 'none', frame-ancestors 'none', no-store, no-referrer를 유지한다.
- 관련 회귀 테스트와 전체 backend pytest를 실행하고 샘플 HTML을 브라우저에서 확인한다. 프론트엔드·DB·외부 메일 발송은 변경하지 않는다.
