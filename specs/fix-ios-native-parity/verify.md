# fix-ios-native-parity — 검증 항목 (구현 전 작성)

## A. 모델 pin
- [A1] ModelPin.build: 유효 모델 → active_sigmoid config, hash 64자 hex, version 이 `^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$` 통과.
- [A2] 키 순서 무관 동일 hash, 다른 params 는 다른 hash.
- [A3] 불량 지표(s<=0, direction 불량, 미지원 키) 제외, 전부 불량/빈 입력이면 nil(코호트 유지).
- [A4] loadOrCreate 1회 pin: 파일 있으면 새 입력 무시, 손상 파일은 새로 기록.
- [A5] configJSON(nil) 은 legacy_cohort 기본값 그대로(회귀 0).
- [A6] 엔진: pin 모델로 만든 엔진의 feature 가 model_version=pin 값, 코호트와 점수 다름 가능(합성 입력). 기존 EngineTests 회귀 0.
- [A7] 매니저: startMeasurement 에 model 전달 시 capture.start payload.model_version = pin, snapshot versions.model = pin; 없으면 b0-cohort-2.

## B. 원시 파형
- [B1] RawPreviewBuffer 용량(EEG 1000·PPG 200) 초과 시 오래된 것 제거, 다운샘플이 처음·끝 유지, 비었으면 빈 배열.
- [B2] 엔진 ingest 후 preview(points) 가 파싱된 샘플을 반환(EEG µV 스케일은 Android 와 동일 4.033/12/8388607*1e6).
- [B3] JS: getRawPreview 가 ios 에서도 플러그인 호출, 웹/기타는 null.

## C. 점검
- [C1] bridge snapshot 중첩 없음 확인(NativeWireContractTests).
- [C2] 구독: 3 특성 setNotifyValue 호출 경로 확인(코드 리뷰, 실기기 항목으로 남김).
- [C3] envelope 이 Rust frame JSON 을 그대로 확장(TNA 필드 투과) 확인.

## 공통
- xcframework 재빌드 후 swift test(기존 20건 이상) 통과, 시뮬레이터 xcodebuild 통과.
- vitest 기준선 17 fail/8파일 외 새 실패 0, tsc -b 0.
- 실기기에서만: BLE 3특성 구독 실제 수신, 백그라운드 복원, 파형 1초 폴링 성능.
