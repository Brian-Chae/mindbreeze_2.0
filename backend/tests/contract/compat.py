"""구 계약(`/sessions/*`) OpenAPI 서브셋 추출·가산 전용 호환 비교기 (SDD-211 C1).

골든 = 구 계약, 현재 = 신 계약. 응답은 "있던 것이 사라지거나 의미가 바뀌면" 파괴,
요청은 "새로 요구하거나 받던 것을 못 받으면" 파괴로 본다. 새 응답 속성·새 선택 요청 속성은 가산이라 통과한다.
순수 함수만 둔다(앱 import 없음) — 합성 스펙으로 단위 테스트한다.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any

# 의도적 파괴 예외(breaking_exemptions.json)의 expires_phase 비교 기준. Phase 가 끝날 때마다 올린다.
CURRENT_PHASE = 0

HTTP_METHODS = ("get", "post", "put", "patch", "delete")
EXEMPTION_REQUIRED_KEYS = ("id", "op", "path", "change", "sdd", "reason", "expires_phase")

JsonDict = dict[str, Any]


@dataclass(frozen=True)
class Violation:
    op: str
    path: str
    change: str
    detail: str = ""

    def __str__(self) -> str:
        return f"{self.op} :: {self.path} :: {self.change} {self.detail}".rstrip()


@dataclass
class CompareResult:
    violations: list[Violation] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


# ── 추출 ──────────────────────────────────────────────


def is_contract_path(path: str) -> bool:
    """구 계약 대상 경로: `/sessions` 를 포함하거나 `{session_id}` 가 있는 경로."""
    return "/sessions" in path or "{session_id}" in path


def op_key(method: str, path: str) -> str:
    return f"{method.upper()} {path}"


def _collect_refs(node: Any, out: set[str]) -> None:
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
            out.add(ref.rsplit("/", 1)[1])
        for value in node.values():
            _collect_refs(value, out)
    elif isinstance(node, list):
        for value in node:
            _collect_refs(value, out)


def _strip_noise(node: Any) -> Any:
    """비교에 쓰지 않는 서술 키(title/description/example 등)를 제거해 골든 diff 노이즈를 줄인다."""
    if isinstance(node, dict):
        return {
            k: _strip_noise(v)
            for k, v in node.items()
            if k not in ("title", "description", "examples", "example")
        }
    if isinstance(node, list):
        return [_strip_noise(v) for v in node]
    return node


def _op_subset(op: JsonDict) -> JsonDict:
    subset: JsonDict = {}
    if op.get("security"):
        subset["security"] = sorted(name for sec in op["security"] for name in sec)
    if op.get("parameters"):
        subset["parameters"] = _strip_noise(op["parameters"])
    if op.get("requestBody"):
        subset["requestBody"] = _strip_noise(op["requestBody"])
    responses = {}
    for status, resp in op.get("responses", {}).items():
        if status == "422":
            continue
        responses[status] = _strip_noise({"content": resp.get("content", {})})
    subset["responses"] = responses
    return subset


def extract_contract(spec: JsonDict) -> JsonDict:
    """OpenAPI → 계약 서브셋 `{operations, components}`. 참조 스키마만 모은다(`$ref` 유지)."""
    operations: JsonDict = {}
    for path, item in spec.get("paths", {}).items():
        if not is_contract_path(path):
            continue
        for method in HTTP_METHODS:
            if method in item:
                operations[op_key(method, path)] = _op_subset(item[method])

    schemas = spec.get("components", {}).get("schemas", {})
    needed: set[str] = set()
    _collect_refs(operations, needed)
    frontier = set(needed)
    while frontier:
        nxt: set[str] = set()
        for name in frontier:
            _collect_refs(schemas.get(name, {}), nxt)
        frontier = nxt - needed
        needed |= nxt
    components = {name: _strip_noise(schemas[name]) for name in sorted(needed) if name in schemas}
    return {"operations": dict(sorted(operations.items())), "components": components}


def success_statuses(op: JsonDict) -> list[str]:
    return sorted(s for s in op.get("responses", {}) if s.startswith("2"))


def response_schema(op: JsonDict, status: str) -> JsonDict:
    """성공 응답의 JSON 스키마(미지정이면 `{}`)."""
    content = op.get("responses", {}).get(status, {}).get("content", {})
    return content.get("application/json", {}).get("schema", {}) or {}


def unspecified_response_ops(contract: JsonDict) -> list[str]:
    """성공 응답에 JSON 스키마가 하나도 없는 op — `response_model` 미지정 라우트."""
    result = []
    for key, op in contract["operations"].items():
        statuses = success_statuses(op)
        if not any(response_schema(op, s) for s in statuses):
            result.append(key)
    return sorted(result)


# ── 스키마 인라인 ─────────────────────────────────────


def inline_refs(node: Any, components: JsonDict, _stack: tuple[str, ...] = ()) -> Any:
    """`$ref` 를 재귀 해소한다. 순환 참조는 `{"$recursive": 이름}` 으로 끊는다."""
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
            name = ref.rsplit("/", 1)[1]
            if name in _stack:
                return {"$recursive": name}
            target = components.get(name, {})
            return inline_refs(target, components, _stack + (name,))
        return {k: inline_refs(v, components, _stack) for k, v in node.items()}
    if isinstance(node, list):
        return [inline_refs(v, components, _stack) for v in node]
    return node


def _split_nullable(schema: JsonDict) -> tuple[JsonDict, bool]:
    """`anyOf: [X, {type: null}]` → (X, True). 그 외는 (schema, False)."""
    any_of = schema.get("anyOf")
    if isinstance(any_of, list):
        non_null = [s for s in any_of if s.get("type") != "null"]
        has_null = len(non_null) != len(any_of)
        if has_null:
            rest = {k: v for k, v in schema.items() if k != "anyOf"}
            if len(non_null) == 1:
                return {**non_null[0], **rest}, True
            return {**rest, "anyOf": non_null}, True
    if schema.get("type") == "null":
        return {}, True
    if schema.get("nullable") is True:
        return {k: v for k, v in schema.items() if k != "nullable"}, True
    return schema, False


# ── 스키마 비교 ───────────────────────────────────────


class _Ctx:
    def __init__(self, op: str, direction: str, result: CompareResult):
        self.op = op
        self.direction = direction  # "response" | "request"
        self.result = result
        self.added: list[str] = []

    def violate(self, path: str, change: str, detail: str = "") -> None:
        self.result.violations.append(Violation(self.op, path, change, detail))


def _compare_schema(g: JsonDict, c: JsonDict, path: str, ctx: _Ctx) -> None:
    if not g:  # 골든이 미지정(불투명)이면 형태 골든(shape)에 위임
        return
    if "$recursive" in g or "$recursive" in c:
        return
    resp = ctx.direction == "response"

    g_core, g_null = _split_nullable(g)
    c_core, c_null = _split_nullable(c)
    if resp and c_null and not g_null:
        ctx.violate(path, "nullable_widened", "응답이 새로 null 을 허용")
    if not resp and g_null and not c_null:
        ctx.violate(path, "nullable_narrowed", "요청이 null 을 더는 받지 않음")

    if not c_core:
        if g_core:
            ctx.violate(path, "schema_removed", "스키마 정보가 사라짐")
        return

    if "anyOf" in g_core or "oneOf" in g_core or "anyOf" in c_core or "oneOf" in c_core:
        if g_core != c_core:
            ctx.violate(path, "union_changed", "anyOf/oneOf 구성이 달라짐")
        return

    if g_core.get("type") != c_core.get("type"):
        ctx.violate(path, "type_changed", f"{g_core.get('type')} → {c_core.get('type')}")
        return
    if g_core.get("format") != c_core.get("format"):
        ctx.violate(path, "format_changed", f"{g_core.get('format')} → {c_core.get('format')}")

    g_enum, c_enum = g_core.get("enum"), c_core.get("enum")
    if g_enum is not None:
        c_values = set(map(repr, c_enum or []))
        g_values = set(map(repr, g_enum))
        if g_values - c_values:
            ctx.violate(path, "enum_value_removed", ", ".join(sorted(g_values - c_values)))
        if resp and (c_values - g_values):
            ctx.violate(path, "enum_value_added", ", ".join(sorted(c_values - g_values)))
    elif c_enum is not None and not resp:
        ctx.violate(path, "enum_introduced", "요청에 enum 제한이 새로 생김")

    if g_core.get("type") == "object" or "properties" in g_core:
        _compare_object(g_core, c_core, path, ctx)
    if g_core.get("type") == "array":
        _compare_schema(g_core.get("items", {}), c_core.get("items", {}), f"{path}[]", ctx)


def _compare_object(g: JsonDict, c: JsonDict, path: str, ctx: _Ctx) -> None:
    resp = ctx.direction == "response"
    g_props, c_props = g.get("properties", {}), c.get("properties", {})
    g_req, c_req = set(g.get("required", [])), set(c.get("required", []))

    for name, g_prop in g_props.items():
        child = f"{path}.{name}" if path else name
        if name not in c_props:
            ctx.violate(child, "removed", "속성이 사라짐(이름 변경 포함)")
            continue
        _compare_schema(g_prop, c_props[name], child, ctx)

    if resp:
        for name in g_req - c_req:
            if name in c_props:
                ctx.violate(f"{path}.{name}" if path else name, "required_relaxed", "필수였던 응답 속성이 선택으로")
    else:
        for name in c_req - g_req:
            child = f"{path}.{name}" if path else name
            change = "request_prop_required" if name in g_props else "request_new_required"
            ctx.violate(child, change, "요청 속성이 새로 필수가 됨")

    new = sorted(set(c_props) - set(g_props))
    if new:
        ctx.added.extend(f"{path}.{n}" if path else n for n in new)

    g_extra, c_extra = g.get("additionalProperties"), c.get("additionalProperties")
    if isinstance(g_extra, dict) and isinstance(c_extra, dict):
        _compare_schema(g_extra, c_extra, f"{path}.*", ctx)


def _param_map(op: JsonDict) -> dict[tuple[str, str], JsonDict]:
    return {(p["in"], p["name"]): p for p in op.get("parameters", [])}


def _body_schema(op: JsonDict) -> tuple[bool, JsonDict]:
    body = op.get("requestBody")
    if not body:
        return False, {}
    content = body.get("content", {})
    media = content.get("application/json") or next(iter(content.values()), {})
    return bool(body.get("required")), media.get("schema", {}) or {}


def _compare_op(key: str, g_op: JsonDict, c_op: JsonDict, result: CompareResult) -> None:
    # 인증: 골든에 없던 보안 요구가 새로 생기면 구 앱 호출이 깨진다
    new_sec = set(c_op.get("security", [])) - set(g_op.get("security", []))
    if new_sec:
        result.violations.append(Violation(key, "security", "auth_required_added", ", ".join(sorted(new_sec))))

    # 성공 상태코드
    g_status, c_status = success_statuses(g_op), success_statuses(c_op)
    for status in g_status:
        if status not in c_status:
            result.violations.append(Violation(key, f"responses.{status}", "status_changed", f"현재 {c_status}"))

    # 응답 스키마
    for status in g_status:
        if status not in c_status:
            continue
        ctx = _Ctx(key, "response", result)
        _compare_schema(response_schema(g_op, status), response_schema(c_op, status), f"responses.{status}", ctx)
        if ctx.added:
            result.warnings.append(f"{key}: 골든에 없는 신규 응답 속성 {len(ctx.added)}개 ({', '.join(sorted(ctx.added)[:5])})")

    # 요청 파라미터
    g_params, c_params = _param_map(g_op), _param_map(c_op)
    for pkey, g_param in g_params.items():
        label = f"parameters.{pkey[0]}.{pkey[1]}"
        if pkey not in c_params:
            result.violations.append(Violation(key, label, "removed", "요청 파라미터가 사라짐"))
            continue
        c_param = c_params[pkey]
        if not g_param.get("required") and c_param.get("required"):
            result.violations.append(Violation(key, label, "request_prop_required", "선택 파라미터가 필수가 됨"))
        ctx = _Ctx(key, "request", result)
        _compare_schema(g_param.get("schema", {}), c_param.get("schema", {}), label, ctx)
    for pkey, c_param in c_params.items():
        if pkey not in g_params and c_param.get("required"):
            result.violations.append(
                Violation(key, f"parameters.{pkey[0]}.{pkey[1]}", "request_new_required", "새 필수 요청 파라미터")
            )

    # 요청 본문
    g_req, g_body = _body_schema(g_op)
    c_req, c_body = _body_schema(c_op)
    if not g_op.get("requestBody") and c_op.get("requestBody") and c_req:
        result.violations.append(Violation(key, "requestBody", "request_new_required", "새 필수 요청 본문"))
    if g_op.get("requestBody"):
        if not c_op.get("requestBody"):
            result.violations.append(Violation(key, "requestBody", "removed", "요청 본문이 사라짐"))
        else:
            if not g_req and c_req:
                result.violations.append(Violation(key, "requestBody", "request_prop_required", "선택 본문이 필수가 됨"))
            ctx = _Ctx(key, "request", result)
            _compare_schema(g_body, c_body, "requestBody", ctx)


def compare_contract(golden: JsonDict, current: JsonDict) -> CompareResult:
    """골든(구) 대비 현재(신)의 가산 전용 호환 검사. 예외 적용 전의 원시 결과를 돌려준다."""
    result = CompareResult()
    g_components, c_components = golden.get("components", {}), current.get("components", {})
    g_ops, c_ops = golden["operations"], current["operations"]

    for key, g_op in g_ops.items():
        if key not in c_ops:
            result.violations.append(Violation(key, "route", "route_removed", "라우트 삭제·이름변경"))
            continue
        g_inl = inline_refs(g_op, g_components)
        c_inl = inline_refs(c_ops[key], c_components)
        _compare_op(key, g_inl, c_inl, result)

    new_routes = sorted(set(c_ops) - set(g_ops))
    if new_routes:
        result.warnings.append(f"골든에 없는 신규 라우트 {len(new_routes)}개: {', '.join(new_routes[:5])}")
    return result


# ── 예외 파일 ─────────────────────────────────────────


def validate_exemptions(items: Any, current_phase: int = CURRENT_PHASE) -> list[str]:
    """예외 파일 형식·만료를 검사해 오류 문자열 목록을 돌려준다(빈 목록이면 유효)."""
    if not isinstance(items, list):
        return ["예외 파일은 배열이어야 한다"]
    errors: list[str] = []
    seen: set[str] = set()
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            errors.append(f"[{index}] 객체가 아님")
            continue
        missing = [k for k in EXEMPTION_REQUIRED_KEYS if k not in item]
        if missing:
            errors.append(f"[{index}] 필수 키 누락: {', '.join(missing)}")
            continue
        for key in ("id", "op", "path", "change", "sdd", "reason"):
            if not isinstance(item[key], str) or not item[key].strip():
                errors.append(f"[{index}] {key} 는 비어 있지 않은 문자열이어야 한다")
        if not isinstance(item["expires_phase"], int) or isinstance(item["expires_phase"], bool):
            errors.append(f"[{index}] expires_phase 는 정수여야 한다")
        elif item["expires_phase"] < current_phase:
            errors.append(f"[{index}] 만료됨: expires_phase={item['expires_phase']} < 현재 Phase {current_phase}")
        if item.get("id") in seen:
            errors.append(f"[{index}] id 중복: {item['id']}")
        seen.add(str(item.get("id")))
    return errors


def apply_exemptions(violations: list[Violation], items: list[JsonDict]) -> list[Violation]:
    """예외 항목과 (op, path, change) 가 모두 같은 위반만 제거한다."""
    allowed = {(i["op"], i["path"], i["change"]) for i in items}
    return [v for v in violations if (v.op, v.path, v.change) not in allowed]


def mutated(contract: JsonDict) -> JsonDict:
    """테스트용 깊은 복사."""
    return copy.deepcopy(contract)
