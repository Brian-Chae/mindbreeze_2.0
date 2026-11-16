# fix: 짧은 측정 리포트 표시 + 앱 PDF 받기 (11/17 대표 실기기 피드백)

## 원인
1. 회원 리포트 860d3a69(5분 측정, 윈도우 316개)가 `member_report_builder.py` "유효 10분 미만 → not_worn 축약"(11/16 A10) 때문에 데이터 없음.
2. 앱에서 PDF 저장이 안 됨: `saveBlobAsFile`(createObjectURL + a.download)이 iOS WKWebView/Android WebView에서 동작하지 않음.
3. 422(데스크톱 `GET /reports/{id}/pdf`): 아래 "422" 절 참고.

## 짧은 측정 규칙 (유효 분 < MIN_VALID_MINUTES=10)
- 착용 판정 = EEG 유효 창이 있고 **값이 있는 지표가 하나 이상**일 때만 worn. 하나도 없으면 not_worn.
- 분석 범위·구간: 회원 실제 측정 범위(첫~끝 유효 분)를 그대로 쓰고 64분 비율로 비례 분할(분이 부족하면 구간이 1분 안팎). 구간 전후 비교는 하지 않는다.
- 지표 섹션: 유효 분이 1분 이상이면 ok. `change=None`(전후 변화 없음), 시계열·구간값·`overall_mean`(측정 전체 평균)을 낸다. 그룹 비교·1/f(전후)는 결측/숨김(group_hidden_reason=min_n, aperiodic=insufficient_window).
- 안정된 5분: 기존 조건(5분 중 4분 이상 움직임·심박)을 만족할 때만, 아니면 생략.
- hero: `meta.short_measure=true` → "측정 시간이 짧아 변화 비교는 어려웠어요" 계열 문장, 전후 쌍 없음, caution 없음.
- 종합 소견·다음 걸음·지표 문장은 change 없는 변형 문장.

## 계약 변경(하위호환)
- `MetricBody.change: Optional[Change] = None`, `MetricBody.overall_mean: Optional[float] = None`, `MemberMeta.short_measure: bool = False`.
- 기존 픽스처 7종 그대로 통과 + 신규 `member-report-short.json`(BE `tests/fixtures/member_report/`, FE `__fixtures__/`).
- 책 PDF(`member_report_book.py`)·FE `MetricCard.tsx`는 change None이면 "평균 X · 측정이 짧아 전후 비교 없음"으로 렌더.

## 앱 PDF 받기
- `lib/native/share-report.ts`에 `savePdfBlob(blob, filename)` 추가: 앱이면 base64 → `@capacitor/filesystem` writeFile(Cache) → `@capacitor/share` share({url}) / 웹이면 a.download.
- `member-report.ts` saveBlobAsFile, `print-report.ts` downloadReportPdf 둘 다 이 함수 사용. 실패 시 오류 문구.

## 422
`GET /reports/{id}/pdf` 는 상담사용 4쪽 PDF 경로로, 본문이 길면 `report_pdf_service.py:64,183` 이 직접 422("4페이지 PDF로 만들 수 없습니다")를 올린다. dev nginx 로그상 같은 ID에서 200 후 422 순으로 1건(11/16 23:19Z). 회원 리포트 ID로 부른 오류가 아니라 의도된 길이 제한 → 수정하지 않음.
