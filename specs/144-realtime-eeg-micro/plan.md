# SDD-144 — 구현 계획

11건 전부 프론트. 1개 그룹으로 병렬 구현.

## 건별 설계

1. **FE-RT-001** — dedup 키 (session_id, participant_id) 확장, 참여자 확정 재join 강제 emit.
2. **FE-PERF-001** — interval mount 1회, 최신 파형 ref 참조.
3. **FE-PERF-002** — sessionRef 로 setMetrics 직접 호출.
4. **FE-RT-004** — /record 싱글톤(참조 카운트) 승격.
5. **FE-BAND-001** — 모듈 레벨 활성 소유자 ref/경고 + connect 1건만.
6. **FE-EEG-001** — 필드 없으면 기존 값 유지, 신규는 false/idle 보수 처리.
7. **FE-EEG-002** — 초과 청크 dead-letter 제거 + 표면화.
8. **FE-PRESENCE-001** — checkin/readiness JSON 직렬화 키로 deps 대체.
9. **FE-DETAIL-001** — 부분 성공마다 setSession + 완료 후 재조회.
10. **FE-RT-005** — lastEvent 디버그 전용 명시(타입 주석).
11. **SEC-04(FE)** — loginPathForRole 기반 리다이렉트.

## 검증

- 프론트 `vitest run` → 44 files / 318 tests
- 프론트 `npm run build` → 0 errors
