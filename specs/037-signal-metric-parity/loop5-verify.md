# 루프5 구현 전 검증 계획

요청된 정본 이식 승인을 근거로 EEG/PPG 처리기만 수정한다.
- 비대칭 채널과 서로 다른 SQI 입력에서 공개 processEEGData 결과가 정본 raw 수치와 일치한다.
- SQI 15 미만 채널이 있으면 FAA는 null이며, 유효 채널이면 로그 차를 반환한다.
- totalPower 기존 키는 채널 평균 총합을 반환하고 totalNeuralActivity를 함께 제공한다.
- PPG RR 경계 200/2000ms 포함, 192/2008ms 제외를 검사한다.
- npm run build 성공을 확인한다.
- 실제 LINK BAND 및 브라우저 검증은 이 작업의 자동 검증에 포함되지 않는다.
