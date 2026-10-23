"""SDD-237 B7: AI 서사 Celery 태스크 — 꺼짐/성공/실패/1회/수정본 보호. 실제 AI 호출은 모두 mock."""

import copy
import json

import pytest
import requests

from app.config import settings
from app.core.celery_app import RetryableTaskError
from app.models.record import Report
from app.services import class_report_narrative as nar
from app.tasks import class_report_task, report_task, summary_task
from tests.sdd237_helpers import add_windows, build_class_world


@pytest.fixture(autouse=True)
def _no_real_ai(monkeypatch, request):
    """실제 외부 호출 방지 — HTTP 계층과 Gemini 래퍼 모두 호출되면 테스트가 실패한다."""
    def boom(*a, **k):
        raise AssertionError("실제 AI/네트워크 호출 금지")

    monkeypatch.setattr(requests, "post", boom)
    monkeypatch.setattr(summary_task, "_call_gemini_text", boom)
    monkeypatch.setattr(settings, "gemini_api_key", "test-key-not-real")
    if "real_enqueue" not in request.keywords:   # enqueue 훅 자체를 검증하는 테스트만 실제 훅을 쓴다
        monkeypatch.setattr(report_task, "_maybe_enqueue_class_narrative", lambda *a, **k: None)


@pytest.fixture
def db(app_client):
    from app.core.database import get_db
    from app.main import app

    session = next(app.dependency_overrides[get_db]())
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def _varying(i):
    return 1.0 + (i // 150) * 2.0   # 전반 낮고 후반 높은 값 → 방향이 생긴다


@pytest.fixture
def world(client, db):
    w = build_class_world(db, members=3)
    for p in w["participants"][:3]:
        add_windows(db, w["session"], p, 300, focus=_varying, relax=lambda i: 1.0 + (i // 150), hr=70.0, rr=14.0)
    report_task.generate_report_inline(str(w["counselor_report"].id), db)
    return w


def block_of(db, w):
    db.expire_all()
    return db.get(Report, w["counselor_report"].id).content["class_report"]


def good_response(block):
    data = nar.build_ai_input(block)
    metrics = {}
    for key in ("respiration", "bpm", "hrv", "focus", "relaxation", "emotional"):
        m = data["metrics"].get(key)
        if m is None:
            metrics[key] = "해당 없음"
            continue
        word = {"up": "높아졌어요", "down": "낮아졌어요", "stable": "비슷했어요"}[m["direction"]]
        label = {"focus": "집중 신호가", "relaxation": "이완 신호가", "emotional": "정서 안정 신호가",
                 "respiration": "호흡이", "bpm": "심박이", "hrv": "심박 간격의 변화가"}[key]
        if key in ("respiration", "bpm"):
            word = {"up": "빨라졌어요", "down": "느려졌어요", "stable": "일정했어요"}[m["direction"]]
        metrics[key] = f"{label} {word}."
    text = "측정한 3명의 집중 신호가 후반에 변했어요."
    first = next((k for k in ("focus", "relaxation") if k in data["metrics"]), None)
    if first:
        d = data["metrics"][first]["direction"]
        text = f"측정한 {data['counts']['measured']}명의 {first == 'focus' and '집중' or '이완'} 신호가 " + {
            "up": "후반으로 갈수록 높아졌어요.", "down": "후반으로 갈수록 낮아졌어요.", "stable": "비슷하게 유지됐어요."}[d]
    return {"headline": text, "body_subtitle": "몸 지표를 이어서 정리했어요.", "mind_subtitle": "마음 지표를 이어서 정리했어요.",
            "metrics": metrics}


def run(db, world):
    return class_report_task.run_class_report_narrative(str(world["session"].id), db)


def mock_ai(monkeypatch, responder):
    calls = []

    def fake(prompt, **kw):
        calls.append({"prompt": prompt, **kw})
        return responder(prompt) if callable(responder) else responder

    monkeypatch.setattr(summary_task, "_call_gemini_text", fake)
    return calls


def test_합성_데이터에서_AI_호출_대상_블록이_만들어졌다(world, db):
    b = block_of(db, world)
    assert nar.build_ai_input(b) is not None, b["status"]


# ── S11 AI 꺼짐 ─────────────────────────────────────────────────
def test_AI_꺼짐이면_호출_0건이고_블록이_바뀌지_않는다(world, db, monkeypatch):
    monkeypatch.setattr(settings, "ai_features_enabled", False)
    calls = mock_ai(monkeypatch, lambda p: "{}")
    before = copy.deepcopy(block_of(db, world))
    assert run(db, world) == "disabled"
    assert calls == []
    assert block_of(db, world) == before
    assert all(f["source"] == "rule" for f in block_of(db, world)["narrative"]["fields"].values())


@pytest.mark.parametrize("status", ["unworn", "zero", "pending", "error", "single", "lost"])
def test_호출_대상이_아닌_상태는_호출_0건(world, db, monkeypatch, status):
    rep = db.get(Report, world["counselor_report"].id)
    c = copy.deepcopy(rep.content)
    c["class_report"]["status"] = status
    rep.content = c
    db.commit()
    calls = mock_ai(monkeypatch, lambda p: "{}")
    assert run(db, world) == "skipped"
    assert calls == []


# ── S12 성공 ────────────────────────────────────────────────────
def test_AI_성공_검증_통과_필드만_ai로_채택된다(world, db, monkeypatch):
    b = block_of(db, world)
    calls = mock_ai(monkeypatch, lambda p: json.dumps(good_response(b), ensure_ascii=False))
    assert run(db, world) == "ok"
    assert len(calls) == 1
    assert calls[0]["json_mode"] is True and calls[0]["timeout"] == 30
    after = block_of(db, world)
    fields = after["narrative"]["fields"]
    assert fields["headline"]["source"] == "ai" and fields["headline"]["ai_draft"]
    assert fields["headline"]["rule_text"]                       # 규칙 문장은 보존
    assert after["narrative"]["ai_attempt"]["outcome"] == "ok"
    assert after["narrative"]["ai_attempt"]["hash"] == nar.ai_input_hash(nar.build_ai_input(b))
    assert after["narrative"]["model"] == settings.gemini_model and after["narrative"]["generated_at"]
    assert after["narrative"]["prompt_version"] == "cr-1"
    # 숫자 통계·상태는 건드리지 않는다
    assert {k: after[k] for k in ("status", "flags", "scope", "metrics", "participants")} == \
           {k: b[k] for k in ("status", "flags", "scope", "metrics", "participants")}
    # participant.* · flow 는 AI 가 쓰지 않는다
    for key, f in fields.items():
        if key == "flow" or key.startswith("participant."):
            assert f["source"] == "rule"


def test_일부_필드만_검증_실패하면_그_필드는_규칙_문장_fallback_fields(world, db, monkeypatch):
    b = block_of(db, world)
    resp = good_response(b)
    resp["mind_subtitle"] = "집중이 크게 개선됐어요."          # 금지어
    mock_ai(monkeypatch, json.dumps(resp, ensure_ascii=False))
    assert run(db, world) == "ok"
    n = block_of(db, world)["narrative"]
    assert n["fields"]["mind_subtitle"]["source"] == "rule" and n["fields"]["mind_subtitle"]["ai_draft"] is None
    assert n["fields"]["headline"]["source"] == "ai"
    assert n["fallback_fields"] == ["mind_subtitle"]


def test_전_필드_폐기면_source가_모두_rule(world, db, monkeypatch):
    mock_ai(monkeypatch, json.dumps({"headline": "점수가 올랐어요", "body_subtitle": "순위", "mind_subtitle": "효과",
                                     "metrics": {}}, ensure_ascii=False))
    assert run(db, world) == "all_rejected"
    n = block_of(db, world)["narrative"]
    assert all(f["source"] == "rule" for f in n["fields"].values())
    assert n["ai_attempt"]["outcome"] == "all_rejected" and n["fallback_fields"]


# ── S13 실패는 규칙 문장 확정, 리포트 상태 불변 ───────────────────
@pytest.mark.parametrize("exc,outcome", [
    (requests.Timeout("timeout"), "timeout"),
    (RetryableTaskError("gemini_http_429"), "http_error"),
    (RetryableTaskError("gemini_http_503"), "http_error"),
    (requests.HTTPError("400"), "http_error"),
    (RuntimeError("gemini_api_key not set"), "no_key"),
    (ValueError("Gemini 응답 형식 불일치"), "schema_mismatch"),
    (Exception("boom"), "error"),
])
def test_AI_실패는_재시도_없이_규칙_문장으로_확정(world, db, monkeypatch, exc, outcome):
    rep = db.get(Report, world["counselor_report"].id)
    before = (rep.status, rep.generation_status, rep.generation_error)
    calls = mock_ai(monkeypatch, lambda p: (_ for _ in ()).throw(exc))
    assert run(db, world) == outcome
    assert len(calls) == 1                                           # 재시도 없음
    b = block_of(db, world)
    assert b["narrative"]["ai_attempt"]["outcome"] == outcome
    assert all(f["source"] == "rule" for f in b["narrative"]["fields"].values())
    db.expire_all()
    rep = db.get(Report, world["counselor_report"].id)
    assert (rep.status, rep.generation_status, rep.generation_error) == before


def test_JSON이_아닌_응답은_schema_mismatch(world, db, monkeypatch):
    mock_ai(monkeypatch, "이건 JSON 이 아니에요")
    assert run(db, world) == "schema_mismatch"
    assert all(f["source"] == "rule" for f in block_of(db, world)["narrative"]["fields"].values())


def test_로그에는_사유_코드만_남고_입력_출력_원문이_없다(world, db, monkeypatch, caplog):
    import logging
    secret = "비밀_AI_출력_원문_XYZ"
    mock_ai(monkeypatch, json.dumps({"headline": secret, "body_subtitle": secret, "mind_subtitle": secret,
                                     "metrics": {}}, ensure_ascii=False))
    with caplog.at_level(logging.DEBUG):
        run(db, world)
    joined = "\n".join(r.getMessage() for r in caplog.records)
    assert secret not in joined and "meditation_class" not in joined


# ── S15 회차당 1회 ──────────────────────────────────────────────
def test_같은_입력_해시로_재실행하면_호출_0건(world, db, monkeypatch):
    b = block_of(db, world)
    calls = mock_ai(monkeypatch, lambda p: json.dumps(good_response(b), ensure_ascii=False))
    assert run(db, world) == "ok"
    assert run(db, world) == "already_attempted"
    assert len(calls) == 1


def test_실패한_시도도_같은_입력이면_다시_부르지_않는다(world, db, monkeypatch):
    calls = mock_ai(monkeypatch, lambda p: (_ for _ in ()).throw(requests.Timeout()))
    assert run(db, world) == "timeout"
    assert run(db, world) == "already_attempted"
    assert len(calls) == 1


def test_리포트_재생성으로_입력이_같으면_호출_0건_바뀌면_1회(world, db, monkeypatch):
    b = block_of(db, world)
    calls = mock_ai(monkeypatch, lambda p: json.dumps(good_response(block_of(db, world)), ensure_ascii=False))
    run(db, world)
    report_task.generate_report_inline(str(world["counselor_report"].id), db)   # 입력 동일 재생성
    assert run(db, world) == "already_attempted" and len(calls) == 1
    # AI 초안은 입력이 같으므로 재생성 후에도 유지된다
    assert block_of(db, world)["narrative"]["fields"]["headline"]["source"] == "ai"
    # 통계가 바뀌면(참여자 윈도우 추가) 입력 해시가 달라져 1회 더 호출
    add_windows(db, world["session"], world["participants"][0], 120, start_offset=300,
                focus=5.0, relax=3.0, hr=60.0, rr=10.0)
    report_task.generate_report_inline(str(world["counselor_report"].id), db)
    if nar.ai_call_needed(block_of(db, world)):
        assert run(db, world) == "ok" and len(calls) == 2


# ── E8 수정본 보호 / P7 수정 문장 미전송 ──────────────────────────
def _edit_headline(db, world, text="상담사가 고친 문장_SECRET"):
    rep = db.get(Report, world["counselor_report"].id)
    c = copy.deepcopy(rep.content)
    n = c["class_report"]["narrative"]
    n["fields"]["headline"].update(edited_text=text, edited_by=str(world["host"].id),
                                   edited_at="2026-10-23T10:00:00Z", edited_input_hash=n["input_hash"],
                                   source="edited")
    rep.content = c
    db.commit()


def test_수정본은_AI가_text_source를_바꾸지_못하고_ai_draft만_갱신된다(world, db, monkeypatch):
    b = block_of(db, world)
    _edit_headline(db, world)
    mock_ai(monkeypatch, lambda p: json.dumps(good_response(b), ensure_ascii=False))
    assert run(db, world) == "ok"
    h = block_of(db, world)["narrative"]["fields"]["headline"]
    assert h["source"] == "edited" and h["edited_text"] == "상담사가 고친 문장_SECRET"
    assert h["ai_draft"]                                              # 초안은 갱신됨(되돌리기용)
    assert nar.resolve_text(h) == "상담사가 고친 문장_SECRET"


def test_AI_입력_프롬프트에_수정_문장_이름_메모가_없다(world, db, monkeypatch):
    from tests.sdd237_helpers import add_record
    add_record(db, world["session"], "비공개 메모 본문_SECRET")
    _edit_headline(db, world)
    b = block_of(db, world)
    calls = mock_ai(monkeypatch, lambda p: json.dumps(good_response(b), ensure_ascii=False))
    run(db, world)
    prompt = calls[0]["prompt"]
    for secret in ("SECRET", "회원1", "회원2", "회원3", "채 상담사", "아침 호흡 명상", "기관", "@e.com"):
        assert secret not in prompt
    for p in world["participants"]:
        assert str(p.id) not in prompt


def test_AI_호출_중_통계가_바뀌어_입력이_달라졌으면_결과를_버린다(world, db, monkeypatch):
    b = block_of(db, world)

    def responder(prompt):
        rep = db.get(Report, world["counselor_report"].id)     # 호출 도중 리포트가 재생성됐다고 가정
        c = copy.deepcopy(rep.content)
        c["class_report"]["narrative"]["input_hash"] = "changed-during-call"
        rep.content = c
        db.commit()
        return json.dumps(good_response(b), ensure_ascii=False)

    mock_ai(monkeypatch, responder)
    assert run(db, world) == "stale_input"
    n = block_of(db, world)["narrative"]
    assert n["ai_attempt"] is None and all(f["source"] == "rule" for f in n["fields"].values())


# ── 조건: 클래스 아님 / 블록 없음 ──────────────────────────────────
def test_블록이_없거나_세션이_없으면_skipped(client, db, monkeypatch):
    w = build_class_world(db, members=1)
    calls = mock_ai(monkeypatch, lambda p: "{}")
    assert class_report_task.run_class_report_narrative(str(w["session"].id), db) == "skipped"
    import uuid
    assert class_report_task.run_class_report_narrative(str(uuid.uuid4()), db) == "skipped"
    assert calls == []


# ── Celery 등록 / enqueue 훅 ────────────────────────────────────
def test_태스크는_celery에_등록되고_report_큐로_라우팅된다():
    from app.core.celery_app import build_task_routes, celery_app
    assert "tasks.class_report_narrative" in celery_app.tasks
    assert build_task_routes(True)["tasks.class_report_narrative"] == {"queue": "report"}
    assert "app.tasks.class_report_task" in celery_app.conf.include
    t = celery_app.tasks["tasks.class_report_narrative"]
    assert not getattr(t, "autoretry_for", ())          # AI 실패는 재시도하지 않는다


@pytest.mark.real_enqueue
def test_리포트_생성_후_AI_호출이_필요하면_enqueue_아니면_하지_않는다(world, db, monkeypatch):
    calls = []
    monkeypatch.setattr("app.tasks.class_report_task.enqueue_class_report_narrative",
                        lambda sid: calls.append(sid))
    monkeypatch.setattr(settings, "ai_features_enabled", True)
    report_task.generate_report_inline(str(world["counselor_report"].id), db)
    assert calls == [str(world["session"].id)]
    calls.clear()
    monkeypatch.setattr(settings, "ai_features_enabled", False)
    report_task.generate_report_inline(str(world["counselor_report"].id), db)
    assert calls == []


@pytest.mark.real_enqueue
def test_회원_리포트_생성은_enqueue하지_않는다(world, db, monkeypatch):
    calls = []
    monkeypatch.setattr("app.tasks.class_report_task.enqueue_class_report_narrative",
                        lambda sid: calls.append(sid))
    report_task.generate_report_inline(str(world["client_reports"][0].id), db)
    assert calls == []


@pytest.mark.real_enqueue
def test_enqueue_실패해도_리포트_생성은_성공한다(world, db, monkeypatch):
    monkeypatch.setattr("app.tasks.class_report_task.enqueue_class_report_narrative",
                        lambda sid: (_ for _ in ()).throw(ConnectionError("broker down")))
    rep = report_task.generate_report_inline(str(world["counselor_report"].id), db)
    assert rep.status in ("pending_review", "completed") and rep.generation_error is None
