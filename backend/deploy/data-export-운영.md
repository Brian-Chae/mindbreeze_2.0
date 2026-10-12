# SDD-071 데이터 다운로드 실행 구성

이 문서는 배포용 구성 안내이며 실제 서비스 설치·재시작·운영 DB 변경은 수행하지 않았다.

## 선행 설정

- Alembic `e036a0000007`을 검토한 뒤 배포 환경에서 적용한다. 작업·감사 테이블 두 개가 추가된다.
- API와 worker는 같은 PostgreSQL, Redis, `S3_BUCKET`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` 설정을 사용한다. P0 export 경로는 명시 자격증명이 없으면 실패하며 스텁 URL을 반환하지 않는다.
- S3 버킷은 비공개로 유지한다. IAM 범위는 export 전용 `data-exports/*`의 PutObject/GetObject/DeleteObject 및 multipart upload 관련 최소 권한으로 제한한다. GET 전 HeadObject에도 GetObject 권한이 필요하다.
- 객체는 `AES256` 서버측 암호화로 업로드된다. 기본 파일명은 `mindbreeze-data.zip`이며 사용자 식별정보를 넣지 않는다.
- 직접 다운로드는 top-level 브라우저 GET이다. JS fetch로 ZIP 바이트를 읽지 않으므로 애플리케이션 CORS 데이터 프록시는 없다.

## 프로세스

`mindbreeze-export-worker.service`와 `mindbreeze-export-beat.service`는 현재 EC2 경로를 사용하는 검토용 systemd 단위 파일이다. 설치 전 환경파일/실행 사용자/경로를 확인한다. 기존 배포 workflow는 이 두 서비스를 자동 설치하지 않으므로 별도 배포 적용이 필요하다.

worker는 `exports` 큐만 소비하고 concurrency=1, prefetch=1로 제한한다. beat는 클러스터당 한 개만 실행한다. 60초마다 `tasks.cleanup_data_exports`가 export 큐에 들어간다. 기존 서사 캐시 업그레이드는 기존 cron이 담당하며 해당 beat 작업을 추가하지 않았다.

수동 검증 명령(backend 디렉터리, 환경변수 설정 이후):

```sh
venv/bin/celery -A app.core.celery_app:celery_app worker -Q exports --concurrency=1 --prefetch-multiplier=1 --loglevel=INFO
venv/bin/celery -A app.core.celery_app:celery_app beat --schedule=/tmp/mindbreeze-export-beat --loglevel=INFO
```

## 한도·만료·복구

- 사용자별 queued/preparing 동시 작업 1건. 단일 참가자 최대 100,000행, 비압축 합계 100MiB. 생성 태스크 soft limit=20분, hard limit=25분.
- 요청시각부터 24시간 후 API 다운로드를 차단한다. URL은 최대 300초이며 S3 HeadObject 확인 뒤에도 패키지 잔여 수명으로 제한한다.
- cleanup은 회당 최대 100건을 정리한다. 삭제 실패는 객체 키를 원장에 유지하고 다음 주기에 재시도한다. 원천 참가자/세션 삭제 후에도 작업 원장을 남겨 보관 객체 정리가 가능하다.
- 객체 물리 삭제는 주기 작업/큐 지연만큼 API 차단보다 늦을 수 있다. S3 수명주기 `data-exports/` 1일 만료를 보조 정책으로 설정하고, 버전 관리 사용 시 noncurrent version·delete marker·미완료 multipart 정리도 구성한다. 애플리케이션 DeleteObject만으로 과거 버전까지 삭제했다고 주장하지 않는다.
- 30분 이상 queued/preparing인 작업은 worker_timeout으로 실패 처리한다. 큐 유실·worker 종료로 영원히 진행 상태가 남지 않는다. 사용자는 새 멱등키로 새 작업을 요청한다.
- 실패 작업/중복 Celery 메시지는 이미 ready인 객체를 덮어쓰지 않는다. 업로드 후 권한·동의·만료를 다시 검사하고 실패 객체는 삭제한다.
- 생성과 다운로드 URL 요청의 권한은 현재 DB 역할·활성 상태·호스트·참가자 귀속으로 검사한다. EEG 동의는 서비스상 수집 동의 확인이며 별도 연구/제3자 제공 허가를 의미하지 않는다.
- URL 발급 이벤트는 로컬 파일 저장 완료 증거가 아니다. 프리사인드 URL은 발급 후 최대 5분 동안 bearer 접근 수단으로 동작한다.

## 배포 후 확인

실제 참가자별 ZIP 내려받기, CSV 29컬럼/null/구간, manifest 해시, S3 암호화·GET attachment, 타 사용자 거부, 24시간 만료 및 객체 삭제, worker 재시작과 queue/beat 관측을 확인한다. 로컬 pytest·빌드가 실제 S3, PostgreSQL 동시 잠금 및 브라우저 다운로드를 입증하지 않는다.
