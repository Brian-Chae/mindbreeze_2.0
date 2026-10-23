"""SDD-237 B3: 규칙 서사 사전 + 필드 상태 기계 (AI 없이 완결되는 문장).

verify P1(금지어 전수)·E9(수정본 이월/stale)·S2/S6 상태 문구.
"""

import itertools

import pytest

from app.services import class_report_narrative as nar
from app.services.class_report_stats_service import METRIC_KEYS, METRIC_UNITS
from app.services.report_narrative import FORBIDDEN_TERMS

CLASS_FORBIDDEN = (
    "종합", "순위", "상위", "하위", "우수", "부족", "양호", "불량", "좋아졌", "나빠졌", "주의가 필요",
    "개선", "악화", "회복", "호전", "완화", "치료", "진단", "증상", "효과", "질환", "잘하", "당신", "여러분",
)


def metric(key, direction, early=50.0, late=60.0, state="ok", measured=4, compared=4):
    unit = METRIC_UNITS[key]
    if state != "ok":
        return {"unit": unit, "state": state, "measured": measured, "compared": 0, "mean": None,
                "early": None, "late": None, "delta": None, "direction": None, "series": []}
    return {"unit": unit, "state": "ok", "measured": measured, "compared": compared, "mean": (early + late) / 2,
            "min": early, "max": late, "early": early, "late": late, "delta": late - early,
            "direction": direction, "valid_min": 30.0, "valid_ratio": 0.8, "agreement": None,
            "missing_reason": None, "series": []}


def block(status="measured", directions=None, measured=4, attended=6, included=5, flags=(),
          duration_min=45, participants=None):
    directions = directions or {}
    metrics = {}
    for key in METRIC_KEYS:
        if key in directions:
            early, late = (14.0, 12.0) if key == "respiration" else (50.0, 60.0)
            metrics[key] = metric(key, directions[key], early, late, measured=measured)
        else:
            metrics[key] = metric(key, None, state="missing", measured=0)
    return {"schema_version": 1, "status": status, "flags": list(flags), "normalization_version": "v1",
            "scope": {"attended": attended, "measured": measured, "included": included,
                      "duration_min": duration_min, "bucket_min": 5, "split_min": duration_min / 2},
            "metrics": metrics, "participants": participants or []}


ALL_UP = {k: "up" for k in METRIC_KEYS}


def texts(fields):
    return {k: v for k, v in fields.items()}


# ── 규칙 문장 사전 ───────────────────────────────────────────────
@pytest.mark.parametrize("key,direction,expected", [
    ("focus", "up", "후반으로 갈수록 집중 신호가 높아졌어요."),
    ("focus", "stable", "집중 신호가 비슷했어요."),
    ("focus", "down", "후반으로 갈수록 집중 신호가 낮아졌어요."),
    ("relaxation", "up", "후반으로 갈수록 이완 신호가 높아졌어요."),
    ("emotional", "down", "후반으로 갈수록 정서 안정 신호가 낮아졌어요."),
    ("bpm", "up", "후반으로 갈수록 심박이 빨라졌어요."),
    ("bpm", "stable", "심박이 일정했어요."),
    ("bpm", "down", "후반으로 갈수록 심박이 느려졌어요."),
    ("respiration", "down", "후반으로 갈수록 호흡이 느려졌어요."),
    ("respiration", "stable", "호흡이 고르게 유지됐어요."),
    ("hrv", "up", "후반으로 갈수록 심박 간격의 변화가 커졌어요."),
    ("hrv", "down", "후반으로 갈수록 심박 간격의 변화가 작아졌어요."),
])
def test_지표_문장_방향_사전(key, direction, expected):
    fields = nar.build_rule_fields(block(directions={key: direction}))
    assert fields[f"metric.{key}"] == expected


def test_측정_1명_또는_결측_지표는_지표_문장을_만들지_않는다():
    b = block(directions={"focus": "up", "bpm": "down"})
    b["metrics"]["relaxation"] = metric("relaxation", None, state="single", measured=1)
    b["metrics"]["hrv"] = metric("hrv", None, state="poor_signal", measured=1)
    fields = nar.build_rule_fields(b)
    assert set(k for k in fields if k.startswith("metric.")) == {"metric.focus", "metric.bpm"}


def test_ok_이지만_비교_불가면_지표_문장이_없다():
    b = block(directions={"focus": "up"})
    b["metrics"]["focus"].update(direction=None, early=None, late=None, delta=None, compared=1)
    assert "metric.focus" not in nar.build_rule_fields(b)


def test_headline_몸과_마음_모두_있는_정상_문장():
    b = block(directions={"respiration": "down", "bpm": "down", "focus": "up", "relaxation": "up"})
    h = nar.build_rule_fields(b)["headline"]
    assert h == ("45분 수업 동안 측정한 4명의 호흡과 심박이 차분해지는 쪽으로 움직였고, "
                 "집중과 이완 신호는 후반으로 갈수록 높아졌어요.")


def test_headline_몸만_있을_때_문장이_끝맺음된다():
    b = block(directions={"respiration": "down", "bpm": "stable"})
    h = nar.build_rule_fields(b)["headline"]
    assert h == "45분 수업 동안 측정한 4명의 호흡과 심박이 차분해지는 쪽으로 움직였어요."


def test_headline_마음만_있을_때():
    b = block(directions={"focus": "stable", "relaxation": "stable"})
    assert nar.build_rule_fields(b)["headline"] == \
        "45분 수업 동안 측정한 4명의 집중과 이완 신호는 비슷하게 유지됐어요."


def test_headline_심박이_빨라지면_조금_빨라졌다고만_쓴다():
    b = block(directions={"respiration": "up", "bpm": "up"})
    assert "조금 빨라졌어요" in nar.build_rule_fields(b)["headline"]


def test_headline_방향이_엇갈리면_그_절을_생략한다():
    b = block(directions={"respiration": "up", "bpm": "down", "focus": "up", "relaxation": "up"})
    h = nar.build_rule_fields(b)["headline"]
    assert "호흡" not in h and "집중과 이완 신호는 후반으로 갈수록 높아졌어요" in h


def test_headline_partial_상태는_대표성_주의_문구를_붙인다():
    b = block(status="partial", directions={"focus": "up"}, measured=2, included=4, attended=4,
              flags=["partial"])
    h = nar.build_rule_fields(b)["headline"]
    assert "측정한 2명" in h and h.endswith("전체 참석자를 대표하지는 않아요.")


def test_headline_연결_끊김_flag면_제외_안내를_붙인다():
    b = block(directions={"focus": "up"}, flags=["lost"])
    assert nar.build_rule_fields(b)["headline"].endswith("일부 구간은 연결이 끊겨 제외됐어요.")


@pytest.mark.parametrize("status,expected", [
    ("single", "측정은 1명이라 클래스 평균은 보여드리지 않아요. 참여자별 결과에서 확인해 주세요."),
    ("unworn", "이번 수업은 LINK BAND 없이 진행됐어요. 참여 기록과 코멘트로 리포트를 이어갈 수 있어요."),
    ("lost", "연결이 끊겨 이번 수업의 측정 데이터를 확인하지 못했어요."),
    ("zero", "이번 수업에는 참석 기록이 없어요."),
    ("pending", "수업 분석이 진행 중이에요. 완료되면 이 자리에 이야기가 채워져요."),
    ("error", "요약을 불러오지 못했어요."),
])
def test_headline_상태별_사실_서술(status, expected):
    b = block(status=status, measured=1 if status == "single" else 0)
    assert nar.build_rule_fields(b)["headline"] == expected


def test_poor_signal_변화_정리가_안_되면_안내_문장():
    b = block(status="poor_signal", directions={}, measured=3)
    assert nar.build_rule_fields(b)["headline"] == "신호가 고르지 않아 이번 수업의 변화는 정리하지 못했어요."


def test_flow_가장_크게_변한_지표_1개만_문장화한다():
    b = block(directions={"focus": "up", "bpm": "down"})
    b["metrics"]["focus"].update(early=52.0, late=61.0, delta=9.0)
    b["metrics"]["bpm"].update(early=72.0, late=70.0, delta=-2.0)  # 3bpm 임계 미만의 작은 변화
    assert nar.build_rule_fields(b)["flow"] == "집중도는 전반 52%에서 후반 61%로 올랐어요."


def test_flow_몸_지표는_소수_한자리와_단위_조사():
    b = block(directions={"respiration": "down"})
    b["metrics"]["respiration"].update(early=14.2, late=12.8, delta=-1.4)
    assert nar.build_rule_fields(b)["flow"] == "호흡수는 전반 14.2회/분에서 후반 12.8회/분으로 내려갔어요."


def test_flow_비교할_지표가_없으면_필드가_없다():
    assert "flow" not in nar.build_rule_fields(block(directions={}))


def test_소제목_body_mind():
    b = block(directions={"respiration": "down", "bpm": "down", "focus": "up", "relaxation": "up"})
    b["metrics"]["respiration"].update(early=14.2, late=12.8, delta=-1.4)
    b["metrics"]["bpm"].update(early=72.0, late=68.0, delta=-4.0)
    f = nar.build_rule_fields(b)
    assert f["body_subtitle"] == "호흡수 14.2→12.8회/분, 심박수 72→68bpm. 전반에서 후반으로 차분해지는 쪽으로 움직였어요."
    assert f["mind_subtitle"].startswith("집중도 50→60%, 이완도 50→60%.")
    assert f["mind_subtitle"].endswith("후반으로 갈수록 집중과 이완 신호가 높아졌어요.")
    assert "body_subtitle" not in nar.build_rule_fields(block(directions={"focus": "up"}))
    assert "mind_subtitle" not in nar.build_rule_fields(block(directions={"bpm": "up"}))


def test_참여자_한_줄():
    rows = [
        {"participant_id": "p1", "state": "measured", "metrics": {
            "respiration": {"direction": "down"}, "focus": {"direction": "up"}, "bpm": {"direction": "stable"}}},
        {"participant_id": "p2", "state": "measured", "metrics": {"focus": {"direction": None}}},
        {"participant_id": "p3", "state": "unworn", "metrics": {}},
        {"participant_id": "p4", "state": "poor_signal", "metrics": {}},
        {"participant_id": "p5", "state": "lost", "metrics": {}},
    ]
    f = nar.build_rule_fields(block(participants=rows))
    assert f["participant.p1"] == "호흡이 느려졌고 집중 신호가 높아졌고 심박이 일정했어요."
    assert f["participant.p2"] == "전반과 후반을 비교하기에는 측정 시간이 짧았어요."
    assert f["participant.p3"] == "측정 없이 참여했어요. 기록과 코멘트로 리포트가 이어져요."
    assert f["participant.p4"] == "신호가 고르지 않아 계산하지 못한 지표가 있어요."
    assert f["participant.p5"] == "연결이 끊겨 측정 구간을 확인하지 못했어요."


def test_참여자_한_줄에는_이름이_들어가지_않는다():
    rows = [{"participant_id": "p1", "state": "measured", "metrics": {"focus": {"direction": "up"}}}]
    f = nar.build_rule_fields(block(participants=rows))
    assert "님" not in f["participant.p1"]


# ── P1 금지어 전수 / 길이 ───────────────────────────────────────
def _all_blocks():
    dirs = ("up", "stable", "down")
    for combo in itertools.product(dirs, repeat=6):
        yield block(directions=dict(zip(METRIC_KEYS, combo)))
    for status in ("single", "unworn", "lost", "zero", "pending", "error", "poor_signal", "partial"):
        yield block(status=status, directions={"focus": "up"}, flags=["lost", "partial"])


def test_규칙_문장에_금지어가_없다_전수():
    banned = CLASS_FORBIDDEN + FORBIDDEN_TERMS
    seen = 0
    for b in _all_blocks():
        for key, text in nar.build_rule_fields(b).items():
            seen += 1
            for term in banned:
                assert term not in text, (key, term, text)
    assert seen > 1000


def test_규칙_문장_길이는_필드_상한_이하():
    for b in _all_blocks():
        for key, text in nar.build_rule_fields(b).items():
            assert 0 < len(text) <= nar.max_len_for(key), (key, text)


def test_max_len_표():
    assert nar.max_len_for("headline") == 200
    assert nar.max_len_for("flow") == 150
    assert nar.max_len_for("body_subtitle") == 150
    assert nar.max_len_for("mind_subtitle") == 150
    assert nar.max_len_for("metric.focus") == 100
    assert nar.max_len_for("participant.abc") == 100


def test_편집_가능_키():
    assert nar.is_editable_key("headline") and nar.is_editable_key("metric.hrv")
    assert nar.is_editable_key("participant.xyz")
    assert not nar.is_editable_key("metric.score") and not nar.is_editable_key("status")
    assert not nar.is_editable_key("participant.")


# ── 필드 상태 기계 ──────────────────────────────────────────────
def test_resolve_text_우선순위():
    f = {"rule_text": "R", "ai_draft": "A", "edited_text": "E", "source": "edited"}
    assert nar.resolve_text(f) == "E"
    assert nar.resolve_text({**f, "source": "ai"}) == "A"
    assert nar.resolve_text({**f, "source": "rule"}) == "R"
    assert nar.resolve_text({**f, "source": "ai", "ai_draft": None}) == "R"


def test_merge_첫_생성은_규칙_문장만():
    out = nar.merge_fields(None, {"headline": "H"}, "h1")
    f = out["headline"]
    assert f["rule_text"] == "H" and f["source"] == "rule"
    assert f["ai_draft"] is None and f["edited_text"] is None


def test_merge_규칙_문장은_항상_최신으로_갱신():
    prev = nar.merge_fields(None, {"headline": "old"}, "h1")
    out = nar.merge_fields(prev, {"headline": "new"}, "h1")
    assert out["headline"]["rule_text"] == "new"


def test_merge_수정본은_재계산_후에도_유지된다():
    prev = {"headline": {"rule_text": "r", "ai_draft": "a", "ai_draft_input_hash": "h1",
                         "edited_text": "내가 쓴 문장", "edited_by": "u1", "edited_at": "2026-10-23T10:00:00Z",
                         "edited_input_hash": "h1", "source": "edited"}}
    out = nar.merge_fields(prev, {"headline": "새 규칙"}, "h1")
    f = out["headline"]
    assert f["source"] == "edited" and f["edited_text"] == "내가 쓴 문장"
    assert f["edited_by"] == "u1" and f["edited_at"] == "2026-10-23T10:00:00Z"
    assert f["rule_text"] == "새 규칙" and f["ai_draft"] == "a"
    assert nar.is_stale(f, "h1") is False


def test_merge_입력_해시가_바뀌면_수정본은_유지하고_stale():
    prev = {"headline": {"rule_text": "r", "ai_draft": "a", "ai_draft_input_hash": "h1",
                         "edited_text": "E", "edited_by": "u1", "edited_at": "t", "edited_input_hash": "h1",
                         "source": "edited"}}
    out = nar.merge_fields(prev, {"headline": "R2"}, "h2")
    assert out["headline"]["edited_text"] == "E" and out["headline"]["source"] == "edited"
    assert nar.is_stale(out["headline"], "h2") is True
    assert out["headline"]["ai_draft"] == "a"  # 되돌리기용 원문 보존


def test_merge_해시가_같으면_AI_초안을_유지_다르면_수정되지_않은_초안은_버린다():
    prev = {"flow": {"rule_text": "r", "ai_draft": "AI", "ai_draft_input_hash": "h1", "edited_text": None,
                     "edited_by": None, "edited_at": None, "edited_input_hash": None, "source": "ai"}}
    same = nar.merge_fields(prev, {"flow": "r2"}, "h1")
    assert same["flow"]["ai_draft"] == "AI" and same["flow"]["source"] == "ai"
    changed = nar.merge_fields(prev, {"flow": "r2"}, "h2")
    assert changed["flow"]["ai_draft"] is None and changed["flow"]["source"] == "rule"


def test_merge_사라진_키는_버리되_수정된_비참여자_필드는_보존한다():
    prev = nar.merge_fields(None, {"metric.hrv": "x", "participant.p1": "y", "flow": "z"}, "h1")
    for k in ("metric.hrv", "participant.p1"):
        prev[k].update(edited_text="수정", source="edited", edited_by="u", edited_at="t", edited_input_hash="h1")
    out = nar.merge_fields(prev, {}, "h1")
    assert "flow" not in out and "participant.p1" not in out  # 참여자 줄은 제외되면 사라진다
    assert out["metric.hrv"]["edited_text"] == "수정" and out["metric.hrv"]["rule_text"] == ""


def test_merge_입력은_변경하지_않는다_불변():
    prev = nar.merge_fields(None, {"headline": "H"}, "h1")
    import copy
    snapshot = copy.deepcopy(prev)
    nar.merge_fields(prev, {"headline": "H2"}, "h2")
    assert prev == snapshot


def test_input_hash는_결정적이고_통계가_바뀌면_바뀐다():
    b1 = block(directions=ALL_UP)
    b2 = block(directions=ALL_UP)
    assert nar.compute_input_hash(b1) == nar.compute_input_hash(b2)
    b2["metrics"]["focus"]["late"] = 99.0
    assert nar.compute_input_hash(b1) != nar.compute_input_hash(b2)


def test_input_hash는_narrative_영역에_영향받지_않는다():
    b1 = block(directions=ALL_UP)
    b2 = {**block(directions=ALL_UP), "narrative": {"fields": {"headline": {"edited_text": "x"}}}}
    assert nar.compute_input_hash(b1) == nar.compute_input_hash(b2)


def test_present_field는_표시_문장과_메타를_합성한다():
    f = {"rule_text": "R", "ai_draft": "A", "ai_draft_input_hash": "h1", "edited_text": "E", "edited_by": "u1",
         "edited_at": "2026-10-23T10:02:11Z", "edited_input_hash": "h0", "source": "edited"}
    out = nar.present_field("headline", f, "h1", {"u1": "채 상담사"})
    assert out == {"text": "E", "source": "edited", "ai_draft": "A", "rule_text": "R", "edited_text": "E",
                   "edited_by": "u1", "edited_by_name": "채 상담사", "edited_at": "2026-10-23T10:02:11Z",
                   "stale": True, "max_len": 200}
