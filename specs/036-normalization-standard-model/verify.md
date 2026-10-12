# SDD-036 Verify — 구현 전 QA 체크리스트

## 1. 백엔드
- [ ] `normalization_baselines` / `normalization_models` 테이블 생성 (alembic upgrade head)
- [ ] `POST /api/v1/normalization/baselines` → baseline 생성
- [ ] `POST /api/v1/normalization/models/compute` → median+MAD 모델 계산 (MIN_BASELINES=5 미만 시 400)
- [ ] `POST /api/v1/normalization/models/{id}/activate` → 단일 활성 모델 유지
- [ ] 비-platform_admin 접근 시 403

## 2. 프론트 정규화 로직
- [ ] transformRaw (ln/abs/그대로) 동작
- [ ] sigmoidScore → 0~100 점수
- [ ] faa 편차형 exp(-ln2·(|faa|/s)²)

## 3. 관리자 UX
- [ ] platform_admin 로그인 시 playground에 표준 모델 관리 패널 표시
- [ ] counselor/client 로그인 시 미표시
- [ ] baseline 캡처 → 목록 → 모델 계산 → 활성화 흐름 동작

## 4. 회귀
- [ ] BE pytest 통과
- [ ] FE build 0 error
- [ ] 기존 playground 지표/트렌드 정상
