"""SDD-214 세션 분류 함수 (plan §4.1).

신규 세션이 어떤 부모(명상 클래스 / 상담 관계 / 없음)에 속할지 유형 + 참여 방식만으로 판정한다.
순수 함수: DB·시계·난수·환경변수 접근 없음. 모델을 import 하지 않고 문자열 값으로만 판단한다.
"""
from dataclasses import dataclass

PARENT_NONE = "none"
PARENT_MEDITATION_CLASS = "meditation_class"
PARENT_COUNSELING_RELATIONSHIP = "counseling_relationship"
PARENT_UNCLASSIFIABLE = "unclassifiable"

RULE_TEMPLATE = "T0"
RULE_MEDITATION = "C1"
RULE_GROUP_CLASS = "C2"
RULE_ONE_ON_ONE = "R3"
RULE_UNCLASSIFIABLE = "X0"

_COUNSELING_TYPES = frozenset({"clinical", "hypnosis", "custom"})


@dataclass(frozen=True)
class SessionFacts:
    is_template: bool
    type: str
    participant_mode: str


@dataclass(frozen=True)
class Classification:
    parent_kind: str
    rule: str


def classify_session(facts: SessionFacts) -> Classification:
    if facts.is_template:
        return Classification(PARENT_NONE, RULE_TEMPLATE)
    if facts.type == "meditation":
        return Classification(PARENT_MEDITATION_CLASS, RULE_MEDITATION)
    if facts.type in _COUNSELING_TYPES:
        if facts.participant_mode == "group":
            return Classification(PARENT_MEDITATION_CLASS, RULE_GROUP_CLASS)
        if facts.participant_mode == "one_on_one":
            return Classification(PARENT_COUNSELING_RELATIONSHIP, RULE_ONE_ON_ONE)
    return Classification(PARENT_UNCLASSIFIABLE, RULE_UNCLASSIFIABLE)
