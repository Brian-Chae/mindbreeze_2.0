# verify (구현 전)
- [ ] BE: 유효 5분 회원 → band_status=worn, 지표 ok(change=None, overall_mean 있음), hero.pairs 비어 있고 short_measure=true, 금지어 검사 통과, MemberReport.model_validate 통과
- [ ] BE: 값이 하나도 없으면 not_worn 유지
- [ ] BE: 10분 이상 기존 동작 불변(기존 픽스처 7종·test_member_report_* 통과)
- [ ] BE: expected_book_pages / 책 PDF 렌더(짧은 픽스처) 빈 쪽 없음
- [ ] FE: 짧은 픽스처 렌더(MetricCard change 없음), 기존 픽스처 통과
- [ ] FE: 앱 경로는 Filesystem.writeFile + Share.share 호출, 웹 경로는 a.download, 실패 시 오류
- [ ] tsc --noEmit, 관련 vitest 통과
- [ ] dev 860d3a69 읽기 전용 로컬 빌드: 값 있는 지표 수·쪽수 확인
