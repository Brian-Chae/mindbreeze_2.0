# SDD-144 — 검증 체크리스트 (Stage ③)

## 기능 동작

- [ ] 참여자 확정 후 재join 이 dedup 에 막히지 않는가? (FE-RT-001)
- [ ] EEG 파형 interval 이 mount 1회만 생성되는가? (FE-PERF-001)
- [ ] setMetrics 가 setSession 업데이터 밖에서 호출되는가? (FE-PERF-002)
- [ ] /record 소켓이 싱글톤으로 공유되는가? (FE-RT-004)
- [ ] useBand 중복 mount 가 감지·차단되는가? (FE-BAND-001)
- [ ] band_connected/upload_status 누락 시 보수 처리되는가? (FE-EEG-001)
- [ ] raw 업로드 초과 청크가 큐에서 제거·표면화되는가? (FE-EEG-002)
- [ ] 대기실 presence effect 가 반복 join 하지 않는가? (FE-PRESENCE-001)
- [ ] 초대 부분 성공이 화면에 반영되는가? (FE-DETAIL-001)
- [ ] lastEvent 가 디버그 전용으로 명시되는가? (FE-RT-005)
- [ ] 401 리다이렉트가 역할별 경로를 쓰는가? (SEC-04 FE)

## 회귀 검증

- [ ] 프론트 vitest 44 files / 318 tests
- [ ] 프론트 build 0 errors
