# Claude 백엔드·EEG·리포트 리뷰 (stdout 회수본)

## 핵심 결론

### 검토로 확정한 MB 2.0 현황 (코드 근거)
- EEG ingestion API **부재**, `EEGRecord`는 배치 1건 스키마(`models/record.py:44-56`), 리포트는 **동기 inline**(`report_service.py:86`)
- 비동기 인프라는 `Celery chain + inline fallback` 패턴 확립(`audio_service.py:110-120`), 세션 종료 훅 존재(`session_service.py:337-342`)
- **numpy/scipy 전무**(requirements 0건) → 서버 밴드파워 계산엔 스택 도입 강제
- `report_task.py:30-31`의 `or 0`/`or {}` 치환이 metrics.py의 **null 보존 원칙과 정면 충돌**

### 5대 결정
1. **feature-worker(Node) 미이식** — 브라우저에서 feature 추출, 백엔드는 집계+지표만(옵션 C). raw는 S3 보존
2. **metrics.py 순수 Python 포팅** — 7지표·정규화 6종·게이트·null 보존. numpy 불필요, 상수 version 추적
3. **저장 2계층** — `EEGFeatureWindow`(TimescaleDB 신규) + `EEGRecord`(요약)
4. **Celery chord** — `group([eeg_aggregate, chain(stt→summary)]) → chord → report_generate`, inline fallback·`/record` WS 재사용
5. **자동 산출 → 상담사 승인 게이트 → 전송**, "두뇌휴식도 = relaxation_score" 단일화

### 리스크 13건
(엣지 산출 신뢰성 / numpy 부재 / null 치환 충돌 / 게이트 미달 표현 / 상수 버전 / broker 운영 / 라이선스 / 생체정보 프라이버시 / EEGRecord 스키마 / 게스트·그룹 소유 / 임계 하드코딩 / 타임라인 동기화 / 실시간 부하)

### 착수 전 블로커 3건
라이선스 승인(R7), null 보존 선행 리팩터(R3), 프로덕션 broker 상시 가동(R6)

> 참고: Claude는 파일 쓰기 승인 요청 후 종료됨 — stdout 요약으로 회수.
