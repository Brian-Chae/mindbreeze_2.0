"""11/19 운영 오류 — 기관관리자 리포트 조회 시 member_report.meta.segments 가 원문 투영에서 지워져
뷰어가 `undefined.find` 로 깨졌다. 회원 리포트 안의 구간 정의는 남기고, 녹취 segments 는 계속 지운다."""
from app.services.class_access_service import without_raw_material


def test_member_report_segments_kept_but_transcript_segments_removed():
    result = {
        "content": {
            "segments": [{"speaker": "A", "text": "원문"}],
            "member_report": {
                "meta": {"segments": [{"key": "prep", "label": "준비·호흡", "start_min": 0, "end_min": 5}]},
                "sections": [{"body": {"my_segments": [{"segment_key": "prep", "value": 1.0}]}}],
                "pdf_url": "https://x/y.pdf",
            },
        },
        "transcript": "원문",
        "pdf_url": "https://x/z.pdf",
    }
    out = without_raw_material(result)
    assert "transcript" not in out and "pdf_url" not in out
    assert "segments" not in out["content"]  # 녹취 원문은 계속 제거
    mr = out["content"]["member_report"]
    assert mr["meta"]["segments"][0]["key"] == "prep"  # 수업 구간 정의는 유지
    assert mr["sections"][0]["body"]["my_segments"][0]["segment_key"] == "prep"
    assert "pdf_url" not in mr  # 리포트 안 URL 은 계속 제거
    # 입력 스냅샷 불변
    assert result["content"]["member_report"]["pdf_url"] == "https://x/y.pdf"
