# summary
- BE: 10분 미만 not_worn 축약 제거, 짧은 측정 리포트(change 없음·평균·흐름), 계약 하위호환 필드 3개, 골든 픽스처 `member-report-short.json`(BE·FE).
- FE: `lib/native/save-pdf.ts`(앱=Filesystem+Share, 웹=a.download), 회원 책 PDF·상담사/공유 링크 PDF 모두 이 경로. MetricCard change null 처리.
- dev 860d3a69(읽기만, 윈도우 316개): 유효 6분(0~5), 지표 7/7 ok. 책 PDF 16쪽 예상(짧은 픽스처 실측 16쪽, 빈 쪽 없음).
- 422: 상담사 4쪽 PDF 길이 제한(의도된 동작).
