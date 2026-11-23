# SDD-332 Plan
- BE: 모델·마이그레이션·`BandDeviceReportRequest`(관대한 검증)·`band_device_service`(UPSERT, 빈 값 미덮어쓰기)·`upload_status`(스키마·쿼리 컬럼 5개 추가, 쿼리 수 불변)·usage 응답.
- FE: `lib/native/app-build-info.ts`(1회 수집·캐시), `band-device-report.ts` 본문 병합, 두 호출부(`useBand`, `use-band-serial-report`), 표시 `appBuildText`.
- 의존성: `@capacitor/device@8.0.3`(iOS SPM·Android 자동 포함, `cap sync`).
- 테스트: BE pytest(CI), FE vitest `tests/sdd332-app-build-info.test.ts` + tsc.
