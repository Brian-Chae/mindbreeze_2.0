# SDD-150 — 구현 계획

| # | 파일 | 변경 |
|---|---|---|
| 1 | LoginPage.tsx | 동의 게이트 client 한정 |
| 2 | ClientEssentialsPage.tsx | prefer_not_to_say 제거 |
| 3 | ClassPlayerPage.tsx | lastFeatureEnvelopeRef + pid별 엔벨로프 |
| 4 | class-join-page.tsx | onSessionStateChanged step 미전환 |

## 테스트

- npm run build(0 errors) + npx vitest run(44/318).
