"""비교기 자체 단위 테스트 (SDD-211 C1 · CS-3).

합성 OpenAPI 입력으로 가산 전용 규칙표의 각 행과 오탐 방지를 검증한다. 앱 import 없음.
"""

from __future__ import annotations

import copy
import uuid

import pytest

from tests.contract import compat, shape


def _obj(props: dict, required: list[str] | None = None) -> dict:
    schema: dict = {"type": "object", "properties": props}
    if required is not None:
        schema["required"] = required
    return schema


def _spec(
    resp_schema: dict | None = None,
    req_schema: dict | None = None,
    params: list | None = None,
    status: str = "200",
    path: str = "/api/v1/sessions/{session_id}",
    method: str = "get",
    components: dict | None = None,
    security: bool = True,
) -> dict:
    op: dict = {"responses": {status: {"description": "ok"}}}
    if resp_schema is not None:
        op["responses"][status] = {"content": {"application/json": {"schema": resp_schema}}}
    if req_schema is not None:
        op["requestBody"] = {"required": True, "content": {"application/json": {"schema": req_schema}}}
    if params is not None:
        op["parameters"] = params
    if security:
        op["security"] = [{"OAuth2PasswordBearer": []}]
    return {"paths": {path: {method: op}}, "components": {"schemas": components or {}}}


def _check(golden: dict, current: dict) -> compat.CompareResult:
    return compat.compare_contract(compat.extract_contract(golden), compat.extract_contract(current))


def _changes(result: compat.CompareResult) -> set[str]:
    return {v.change for v in result.violations}


UUID_A, UUID_B, UUID_C = (str(uuid.UUID(int=n)) for n in (0xA1, 0xB2, 0xC3))
BASE = _obj({"id": {"type": "string", "format": "uuid"}, "name": {"type": "string"}}, ["id"])


def test_추출은_sessions_경로만_고른다():
    spec = _spec(BASE)
    spec["paths"]["/api/v1/auth/login"] = {"post": {"responses": {"200": {"description": "ok"}}}}
    spec["paths"]["/api/v1/reports/generate/{session_id}"] = {"post": {"responses": {"201": {"description": "ok"}}}}
    keys = set(compat.extract_contract(spec)["operations"])
    assert keys == {"GET /api/v1/sessions/{session_id}", "POST /api/v1/reports/generate/{session_id}"}


def test_동일_계약은_통과한다():
    assert _check(_spec(BASE), _spec(copy.deepcopy(BASE))).violations == []


def test_라우트_삭제와_이름변경은_실패한다():
    golden = _spec(BASE)
    renamed = _spec(BASE, path="/api/v1/sessions/{session_id}/x")
    assert _changes(_check(golden, renamed)) == {"route_removed"}


def test_신규_라우트는_통과하고_경고한다():
    golden = _spec(BASE)
    current = _spec(BASE)
    current["paths"]["/api/v1/sessions/new"] = {"get": {"responses": {"200": {"description": "ok"}}}}
    result = _check(golden, current)
    assert result.violations == []
    assert any("신규 라우트" in w for w in result.warnings)


def test_성공_상태코드_변경은_실패한다():
    assert "status_changed" in _changes(_check(_spec(BASE, status="201"), _spec(BASE, status="200")))


def test_응답_속성_삭제와_이름변경은_실패한다():
    removed = _obj({"id": BASE["properties"]["id"]}, ["id"])
    renamed = _obj({"id": BASE["properties"]["id"], "full_name": {"type": "string"}}, ["id"])
    assert _changes(_check(_spec(BASE), _spec(removed))) == {"removed"}
    assert _changes(_check(_spec(BASE), _spec(renamed))) == {"removed"}


def test_응답_속성_추가는_통과하고_경고한다():
    added = _obj({**BASE["properties"], "extra": {"type": "integer"}}, ["id", "extra"])
    result = _check(_spec(BASE), _spec(added))
    assert result.violations == []
    assert any("신규 응답 속성" in w for w in result.warnings)


def test_응답_타입과_format_변경은_실패한다():
    retyped = _obj({"id": {"type": "integer"}, "name": {"type": "string"}}, ["id"])
    reformatted = _obj({"id": {"type": "string"}, "name": {"type": "string"}}, ["id"])
    assert _changes(_check(_spec(BASE), _spec(retyped))) == {"type_changed"}
    assert _changes(_check(_spec(BASE), _spec(reformatted))) == {"format_changed"}


def test_응답_널허용_확대는_실패하고_축소는_통과한다():
    nullable = _obj({"id": BASE["properties"]["id"], "name": {"anyOf": [{"type": "string"}, {"type": "null"}]}}, ["id"])
    assert _changes(_check(_spec(BASE), _spec(nullable))) == {"nullable_widened"}
    assert _check(_spec(nullable), _spec(BASE)).violations == []


def test_응답_필수_해제는_실패하고_필수_추가는_통과한다():
    relaxed = _obj(BASE["properties"], [])
    assert _changes(_check(_spec(BASE), _spec(relaxed))) == {"required_relaxed"}
    stricter = _obj(BASE["properties"], ["id", "name"])
    assert _check(_spec(BASE), _spec(stricter)).violations == []


def test_응답_enum_값_삭제와_추가는_모두_실패한다():
    def with_enum(values: list[str]) -> dict:
        return _obj({"status": {"type": "string", "enum": values}}, ["status"])

    golden = _spec(with_enum(["a", "b"]))
    assert _changes(_check(golden, _spec(with_enum(["a"])))) == {"enum_value_removed"}
    assert _changes(_check(golden, _spec(with_enum(["a", "b", "c"])))) == {"enum_value_added"}


def test_배열_원소_타입_변경은_실패한다():
    golden = _spec({"type": "array", "items": {"type": "string"}})
    current = _spec({"type": "array", "items": {"type": "integer"}})
    assert _changes(_check(golden, current)) == {"type_changed"}


def test_ref_는_인라인_해소_후_비교하므로_스키마_이름_변경을_무시한다():
    golden = _spec({"$ref": "#/components/schemas/Old"}, components={"Old": BASE})
    current = _spec({"$ref": "#/components/schemas/New"}, components={"New": copy.deepcopy(BASE)})
    assert _check(golden, current).violations == []
    removed = _obj({"id": BASE["properties"]["id"]}, ["id"])
    current_bad = _spec({"$ref": "#/components/schemas/New"}, components={"New": removed})
    assert _changes(_check(golden, current_bad)) == {"removed"}


def test_중첩_참조의_속성_삭제도_잡는다():
    inner = _obj({"a": {"type": "string"}, "b": {"type": "string"}}, ["a"])
    outer = lambda inner_schema: _obj({"inner": {"$ref": "#/components/schemas/Inner"}}, ["inner"])  # noqa: E731
    golden = _spec(outer(inner), components={"Inner": inner})
    current_inner = _obj({"a": {"type": "string"}}, ["a"])
    current = _spec(outer(current_inner), components={"Inner": current_inner})
    result = _check(golden, current)
    assert [v.path for v in result.violations] == ["responses.200.inner.b"]


def test_순환_참조는_무한루프_없이_끊긴다():
    node = _obj({"child": {"$ref": "#/components/schemas/Node"}, "v": {"type": "string"}})
    spec = _spec({"$ref": "#/components/schemas/Node"}, components={"Node": node})
    assert _check(spec, copy.deepcopy(spec)).violations == []


def test_미지정_응답_스키마는_비교하지_않고_위임한다():
    golden = _spec({})
    current = _spec(BASE)
    assert _check(golden, current).violations == []
    assert compat.unspecified_response_ops(compat.extract_contract(golden)) == ["GET /api/v1/sessions/{session_id}"]


def test_요청_본문_속성_삭제와_타입_변경은_실패한다():
    body = _obj({"title": {"type": "string"}, "n": {"type": "integer"}}, ["title"])
    dropped = _obj({"title": {"type": "string"}}, ["title"])
    retyped = _obj({"title": {"type": "string"}, "n": {"type": "string"}}, ["title"])
    golden = _spec(BASE, body, method="post")
    assert _changes(_check(golden, _spec(BASE, dropped, method="post"))) == {"removed"}
    assert _changes(_check(golden, _spec(BASE, retyped, method="post"))) == {"type_changed"}


def test_요청_선택이_필수가_되거나_새_필수가_생기면_실패한다():
    body = _obj({"title": {"type": "string"}, "n": {"type": "integer"}}, ["title"])
    now_required = _obj(body["properties"], ["title", "n"])
    new_required = _obj({**body["properties"], "m": {"type": "string"}}, ["title", "m"])
    golden = _spec(BASE, body, method="post")
    assert _changes(_check(golden, _spec(BASE, now_required, method="post"))) == {"request_prop_required"}
    assert _changes(_check(golden, _spec(BASE, new_required, method="post"))) == {"request_new_required"}


def test_요청_새_선택_속성과_enum_추가는_통과한다():
    body = _obj({"kind": {"type": "string", "enum": ["a"]}}, ["kind"])
    wider = _obj({"kind": {"type": "string", "enum": ["a", "b"]}, "memo": {"type": "string"}}, ["kind"])
    golden = _spec(BASE, body, method="post")
    assert _check(golden, _spec(BASE, wider, method="post")).violations == []


def test_요청_enum_값_삭제는_실패한다():
    body = _obj({"kind": {"type": "string", "enum": ["a", "b"]}}, ["kind"])
    narrower = _obj({"kind": {"type": "string", "enum": ["a"]}}, ["kind"])
    golden = _spec(BASE, body, method="post")
    assert _changes(_check(golden, _spec(BASE, narrower, method="post"))) == {"enum_value_removed"}


def test_요청_파라미터_삭제_필수화_신규필수는_실패하고_신규선택은_통과한다():
    q = {"name": "q", "in": "query", "required": False, "schema": {"type": "string"}}
    golden = _spec(BASE, params=[q])
    assert _changes(_check(golden, _spec(BASE, params=[]))) == {"removed"}
    assert _changes(_check(golden, _spec(BASE, params=[{**q, "required": True}]))) == {"request_prop_required"}
    new_required = {"name": "z", "in": "query", "required": True, "schema": {"type": "string"}}
    assert _changes(_check(golden, _spec(BASE, params=[q, new_required]))) == {"request_new_required"}
    new_optional = {"name": "z", "in": "query", "required": False, "schema": {"type": "string"}}
    assert _check(golden, _spec(BASE, params=[q, new_optional])).violations == []


def test_새로_생긴_인증_요구는_실패한다():
    assert _changes(_check(_spec(BASE, security=False), _spec(BASE, security=True))) == {"auth_required_added"}


def test_예외는_op_path_change_가_모두_같을_때만_위반을_제거한다():
    violations = [compat.Violation("GET /a", "x.y", "removed"), compat.Violation("GET /a", "x.z", "removed")]
    item = {
        "id": "E1", "op": "GET /a", "path": "x.y", "change": "removed",
        "sdd": "SDD-999", "reason": "테스트", "expires_phase": 3,
    }
    assert compat.apply_exemptions(violations, [item]) == [violations[1]]
    assert compat.apply_exemptions(violations, [{**item, "change": "type_changed"}]) == violations


@pytest.mark.parametrize(
    "items, expect",
    [
        ([], True),
        ({}, False),
        ([{"id": "E1"}], False),
        ([{"id": "E1", "op": "GET /a", "path": "p", "change": "removed", "sdd": "S", "reason": "r", "expires_phase": 0}], True),
        ([{"id": "E1", "op": "GET /a", "path": "p", "change": "removed", "sdd": "S", "reason": "r", "expires_phase": "0"}], False),
        ([{"id": "E1", "op": "GET /a", "path": "p", "change": "removed", "sdd": "S", "reason": " ", "expires_phase": 0}], False),
    ],
)
def test_예외_파일_형식_검증(items, expect):
    assert (compat.validate_exemptions(items, current_phase=0) == []) is expect


def test_예외는_expires_phase_가_지나면_만료된다():
    item = {"id": "E1", "op": "GET /a", "path": "p", "change": "removed", "sdd": "S", "reason": "r", "expires_phase": 2}
    assert compat.validate_exemptions([item], current_phase=2) == []
    assert any("만료" in e for e in compat.validate_exemptions([item], current_phase=3))


# ── 형태(shape) 비교기 ─────────────────────────────────


def test_형태는_값이_아니라_타입_태그로_저장한다():
    value = {
        "id": UUID_A,
        "created_at": "2026-10-18T09:00:00+09:00",
        "day": "2026-10-18",
        "link": "https://example.com/x",
        "n": 3, "f": 1.5, "ok": True, "memo": None, "name": "홍길동",
    }
    assert shape.shape_of(value) == {
        "created_at": "datetime", "day": "date", "f": "number", "id": "uuid", "link": "url",
        "memo": "null", "n": "number", "name": "str", "ok": "bool",
    }


def test_배열_형태는_원소_키_합집합이고_일부에만_있으면_선택_표기한다():
    value = [{"a": 1, "b": "x"}, {"a": 2}]
    assert shape.shape_of(value) == [{"a": "number", "b?": "str"}]
    assert shape.shape_of([]) == []


def test_형태_호환_키_삭제와_태그_변경은_실패하고_추가는_통과한다():
    golden = shape.shape_of({"id": UUID_A, "n": 1})
    assert shape.compare_shape(golden, shape.shape_of({"id": UUID_A, "n": 2, "x": 1})) == []
    assert shape.compare_shape(golden, shape.shape_of({"id": UUID_A})) == ["$.n: 키가 사라짐"]
    assert shape.compare_shape(golden, shape.shape_of({"id": "abc", "n": 1})) == ["$.id: 타입 태그 uuid → str"]


def test_골든이_null_이면_키_존재만_본다():
    golden = shape.shape_of({"memo": None})
    assert shape.compare_shape(golden, shape.shape_of({"memo": "값"})) == []
    assert shape.compare_shape(golden, shape.shape_of({})) == ["$.memo: 키가 사라짐"]


def test_봉인_응답은_키가_늘면_실패한다():
    golden = shape.shape_of({"title": "a", "host_name": "b"})
    assert shape.compare_shape(golden, shape.shape_of({"title": "a", "host_name": "b", "email": "c"})) == []
    problems = shape.compare_shape(golden, shape.shape_of({"title": "a", "host_name": "b", "email": "c"}), strict_keys=True)
    assert problems and "email" in problems[0]


def test_키가_UUID_인_맵은_하나의_키로_접어_비결정성을_없앤다():
    first = {UUID_A: {"after": 1}, UUID_B: {"after": 2}}
    other = {UUID_C: {"after": 3}}
    assert shape.shape_of(first) == {"<uuid>": {"after": "number"}}
    assert shape.compare_shape(shape.shape_of(first), shape.shape_of(other)) == []
