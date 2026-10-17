"""JSON 응답 → 형태 트리(키 + 타입 태그)와 호환 비교 (SDD-211 C1).

값이 아니라 형태만 저장해 UUID·시각·토큰의 비결정성을 없앤다.
태그: uuid · datetime · date · url · str · number · bool · null. 배열은 `[원소 형태 합집합]`,
일부 원소에만 있는 키는 `키?` 로 표기한다. 순수 함수만 둔다.
"""

from __future__ import annotations

import re
from typing import Any

_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_DATETIME = re.compile(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_URL = re.compile(r"^https?://")

Shape = Any


def _tag_str(value: str) -> str:
    if _UUID.match(value):
        return "uuid"
    if _DATETIME.match(value):
        return "datetime"
    if _DATE.match(value):
        return "date"
    if _URL.match(value):
        return "url"
    return "str"


def _merge(a: Shape, b: Shape) -> Shape:
    """두 형태의 합집합. 한쪽에만 있는 키는 `?` 를 붙이고, 같은 키의 형태는 재귀 병합한다."""
    if a == "null":
        return b
    if b == "null":
        return a
    if isinstance(a, dict) and isinstance(b, dict):
        merged: dict[str, Shape] = {}
        a_keys = {k.rstrip("?"): k for k in a}
        b_keys = {k.rstrip("?"): k for k in b}
        for base in sorted(set(a_keys) | set(b_keys)):
            in_a, in_b = base in a_keys, base in b_keys
            optional = not (in_a and in_b) or a_keys.get(base, "").endswith("?") or b_keys.get(base, "").endswith("?")
            if in_a and in_b:
                value = _merge(a[a_keys[base]], b[b_keys[base]])
            else:
                value = a[a_keys[base]] if in_a else b[b_keys[base]]
            merged[f"{base}?" if optional else base] = value
        return merged
    if isinstance(a, list) and isinstance(b, list):
        if not a:
            return b
        if not b:
            return a
        return [_merge(a[0], b[0])]
    return a


def shape_of(value: Any) -> Shape:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return _tag_str(value)
    if isinstance(value, list):
        if not value:
            return []
        merged = shape_of(value[0])
        for item in value[1:]:
            merged = _merge(merged, shape_of(item))
        return [merged]
    if isinstance(value, dict):
        return {k: shape_of(v) for k, v in sorted(value.items())}
    return "str"


def compare_shape(golden: Shape, current: Shape, path: str = "$", strict_keys: bool = False) -> list[str]:
    """골든의 모든 키가 현재에 존재하고 태그가 같아야 한다. 추가 키는 통과(strict_keys 면 실패).

    골든 값이 `null` 이면 키 존재만 보고 타입은 보지 않는다. 골든이 `[]` 이면 원소 검사를 건너뛴다.
    """
    problems: list[str] = []
    if golden == "null":
        return problems
    if isinstance(golden, dict):
        if not isinstance(current, dict):
            return [f"{path}: object 였으나 {_describe(current)}"]
        current_keys = {k.rstrip("?"): k for k in current}
        for gkey, gval in golden.items():
            base = gkey.rstrip("?")
            optional = gkey.endswith("?")
            if base not in current_keys:
                if not optional:
                    problems.append(f"{path}.{base}: 키가 사라짐")
                continue
            problems.extend(compare_shape(gval, current[current_keys[base]], f"{path}.{base}"))
        if strict_keys:
            extra = sorted(set(current_keys) - {k.rstrip("?") for k in golden})
            if extra:
                problems.append(f"{path}: 봉인 응답에 키가 추가됨 {extra}")
        return problems
    if isinstance(golden, list):
        if not isinstance(current, list):
            return [f"{path}: array 였으나 {_describe(current)}"]
        if golden and current:
            problems.extend(compare_shape(golden[0], current[0], f"{path}[]"))
        return problems
    if golden != current:
        return [f"{path}: 타입 태그 {golden} → {_describe(current)}"]
    return problems


def _describe(shape: Shape) -> str:
    if isinstance(shape, dict):
        return "object"
    if isinstance(shape, list):
        return "array"
    return str(shape)
