"""SDD-327 T0 — 회원 개인 명상 리포트(v11) 데이터 계약.

`reports.content.member_report`(JSONB)에 저장되는 단일 계약이다. 화면(M1·M2)·PDF 책(M3)은 이 JSON만 읽는다.
- FE 사본: `frontend/src/lib/member-report/types.ts` (수동 동기화 + JSON Schema 드리프트 테스트)
- 골든 픽스처: `backend/tests/fixtures/member_report/*.json` (확정 시안 v11 추출)

결측 표현 원칙(0으로 채우지 않는다):
- 밴드 미착용            → `band_status="not_worn"`, 모든 지표 섹션 `state="missing"(band_not_worn)`
- 지표 신호 부족          → 섹션 `state="missing"`, `missing_reason="poor_signal"`
- 1/f(aperiodic) 산출 불가 → `metrics.aperiodic.state="missing"` + `no_raw|insufficient_window|poor_fit`
                             (키 자체를 None으로 둬도 동일하게 "생략" 취급)
- 그룹 유효 인원 < MIN_GROUP_N → `body.group=None`, `group_hidden_reason="min_n"`, `series.group_band=None` (숫자도 미전송)
- 시계열 결측 분           → 배열 원소 None (선을 끊는다)
- 매분 그룹 띠: 해당 분 인원 < MIN_BAND_N → 그 분의 p10~p90 모두 None
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, model_validator

SCHEMA_VERSION = "member_report.v1"

# 그룹 비교(분포·점선 평균) 표시 최소 유효 인원 / 매분 그룹 띠 최소 인원 / 개인 유효 시간(분)
MIN_GROUP_N = 10
MIN_BAND_N = 5
MIN_VALID_MINUTES = 10

MetricKey = Literal[
    "motion", "heart_rate", "rmssd", "lf_hf", "focus", "relaxation", "emotional_balance", "aperiodic"
]
SegmentKey = Literal["prep", "move", "first_half", "second_half"]
Direction = Literal["up", "down", "stable"]
BandStatus = Literal["worn", "not_worn"]
MetricState = Literal["ok", "missing"]
MissingReason = Literal[
    "band_not_worn",  # 밴드 미착용(회원 전체)
    "poor_signal",  # 신호 부족(유효 비율 미달)
    "no_raw",  # 원시 EEG 없음 (aperiodic)
    "insufficient_window",  # 유효 구간 합산 180초 미만 (aperiodic)
    "poor_fit",  # 적합도 R² < 0.9 (aperiodic)
]
Tone = Literal["calm", "neutral"]
ScaleSide = Literal["below", "within", "above"]
NarrativeSource = Literal["rule", "ai"]
PageKey = Literal[
    "cover", "toc", "summary", "opinion", "journey", "motion", "stable5", "heart_rate", "rmssd",
    "lf_hf", "focus", "relaxation", "emotional_balance", "aperiodic", "next_steps", "memo", "method", "back",
]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ── 메타 ───────────────────────────────────────────────────────────
class Segment(_Strict):
    """수업 구간. 분 단위는 수업 시작(start_clock) 기준 경과 분, 양끝 포함."""

    key: SegmentKey
    label: str
    start_min: int
    end_min: int


class MemberMeta(_Strict):
    member_code: str  # 회원 식별 코드 `B{클래스}-{순번}` — 실명 금지
    program_label: str  # 예: 몸돌봄 2회차
    chapter_label: str  # 예: 章 1 · 몸돌봄 2회차 · 11/11
    session_date: str  # YYYY-MM-DD
    start_clock: str  # HH:MM
    device_text: str
    basis_text: str
    reference_group_text: Optional[str] = None
    issued_on: str  # YYYY-MM-DD
    volume_label: str  # VOLUME 01
    band_status: BandStatus
    segments: list[Segment]
    first_minute: int  # 분석 시작 분 (시안 2)
    last_minute: int  # 분석 종료 분 (시안 63)


# ── 요약(3쪽) ──────────────────────────────────────────────────────
class EffectPair(_Strict):
    key: Literal["heart_rate", "relaxation", "motion", "focus"]
    name: str
    unit: str
    before: str  # 표시 문자열(시안 그대로, 예 "75.0")
    after: str
    change_text: str  # 예 "↓ 17.0 감소"
    direction: Direction
    tone: Tone


class StableSummary(_Strict):
    title: str
    lines: list[str]
    note: str


class Hero(_Strict):
    kicker: str
    headline: str  # 줄바꿈 \n
    lead: str
    pair_caption_before: Optional[str] = None
    pair_caption_after: Optional[str] = None
    pairs: list[EffectPair]  # 미착용·결측이면 가용 지표만(빈 배열 가능)
    caution: Optional[str] = None
    other_directions: Optional[str] = None
    stable_summary: Optional[StableSummary] = None


class Narrative(_Strict):
    eyebrow: str
    title: str
    body: str
    source: NarrativeSource = "rule"


# ── 안정된 5분(7쪽) + 종합 의견 표(4쪽) ────────────────────────────
class ReferenceScale(_Strict):
    key: Literal["heart_rate", "rmssd", "sdnn"]
    title: str  # 예 "안정 심박 회/분"
    value: float
    decimals: int
    unit: str
    pill: str  # 예 "성인 안내 범위 아래"
    overview_position: str  # 예 "범위 밖"
    side: ScaleSide
    range_note: str
    band_lo: float
    band_hi: float
    axis_min: float
    axis_max: float
    group_median: Optional[float] = None
    group_n: Optional[int] = None  # 움직임 오염 표시 없는 인원
    meaning: list[str]  # 낮은 쪽 / 참고 띠 / 높은 쪽 설명 3개
    explain: str
    note: str
    overview_line: str


class Stable5(_Strict):
    window_label: str  # 예 "[48,53)"
    eyebrow: str
    title: str
    narrative: str
    scales: list[ReferenceScale]
    reading: str
    callout_title: str
    callout_body: str
    contaminated: bool  # 움직임 오염 표시 여부


class Opinion(_Strict):
    narrative: Narrative
    table_title: str
    interpret_title: str
    interpret_body: str
    reading: str
    footnote: str
    legend_note: str


class Journey(_Strict):
    eyebrow: str
    title: str
    body: str
    chart_keys: list[MetricKey]  # 그룹 흐름을 다시 그릴 지표 (데이터는 metrics에서 재사용)
    stable_basis_note: str
    footer_note: str


# ── 지표 섹션 ──────────────────────────────────────────────────────
class Change(_Strict):
    before: float
    after: float
    delta: float
    direction: Direction
    decimals: int
    unit: str
    label: str  # 예 "가속도 크기"


class GroupBand(_Strict):
    """매분 그룹 분포 띠. 집계만, 타 회원 값·ID 없음. 인원 < MIN_BAND_N 인 분은 모두 None."""

    p10: list[Optional[float]]
    p25: list[Optional[float]]
    p50: list[Optional[float]]
    p75: list[Optional[float]]
    p90: list[Optional[float]]


class MetricSeries(_Strict):
    minutes: list[int]  # 경과 분(오름차순, first_minute..last_minute)
    values: Optional[list[Optional[float]]] = None  # 나의 매분 값, 결측 None
    norm: Optional[list[Optional[float]]] = None  # 0~1 축 높이(LF/HF log1p 등). values 없을 때 필수
    value_transform: Literal["linear", "log1p"] = "linear"
    axis_min: Optional[float] = None
    axis_max: Optional[float] = None
    axis_unit: str
    group_band: Optional[GroupBand] = None  # 그룹 숨김이면 None

    @model_validator(mode="after")
    def _check(self) -> "MetricSeries":
        n = len(self.minutes)
        if self.values is None and self.norm is None:
            raise ValueError("values 또는 norm 중 하나는 필요")
        for arr in (self.values, self.norm):
            if arr is not None and len(arr) != n:
                raise ValueError("시계열 길이 불일치")
        if self.group_band is not None:
            for arr in (self.group_band.p10, self.group_band.p25, self.group_band.p50,
                        self.group_band.p75, self.group_band.p90):
                if len(arr) != n:
                    raise ValueError("그룹 띠 길이 불일치")
        return self


class SegmentValue(_Strict):
    segment_key: SegmentKey
    value: Optional[float] = None  # 나의 구간 중앙값


class SegmentCompareRow(_Strict):
    segment_key: SegmentKey
    mine: Optional[float] = None
    group: Optional[float] = None
    diff: Optional[float] = None
    compared_minutes: int


class Distribution(_Strict):
    """그룹 분포 + 나의 매분 히스토그램. 집계(곡선·평균·SD)만."""

    axis_ticks: list[float]  # 5개
    mean_me: float
    mean_group: float
    sd_group: float
    n_people: int
    n_person_minutes: int
    my_minutes: int
    density: list[float]  # 0~1 정규화한 그룹 밀도 곡선(균등 격자)
    my_bars: list[float]  # 0~1 정규화한 나의 매분 히스토그램(5구간)


class GroupBlock(_Strict):
    title: str  # 그룹은 보조로 · 같은 수업 기록과 함께 읽어요
    explain: str
    distribution: Distribution
    rows: list[SegmentCompareRow]
    table_note: str
    legend: str


class MetricBody(_Strict):
    eyebrow: str
    conclusion: str
    bridge: Optional[str] = None
    change: Change
    series: MetricSeries
    series_legend: str
    my_segments: list[SegmentValue]
    interpretation: str  # 이게 무슨 뜻이에요
    reading: Optional[str] = None  # 이렇게 읽어요
    result_note: Optional[str] = None  # 결과 해석
    source_note: Optional[str] = None
    group: Optional[GroupBlock] = None
    group_hidden_reason: Optional[Literal["min_n"]] = None

    @model_validator(mode="after")
    def _check(self) -> "MetricBody":
        if self.group is None and self.series.group_band is not None:
            raise ValueError("그룹 숨김 시 group_band 도 숨겨야 함(숫자 미전송)")
        if self.group is None and self.group_hidden_reason is None and self.series.group_band is None:
            pass  # LF/HF처럼 원래 그룹이 없는 지표
        return self


class MetricSection(_Strict):
    key: MetricKey
    title: str  # 쪽 제목
    chapter: Literal["body", "mind"]
    state: MetricState
    missing_reason: Optional[MissingReason] = None
    body: Optional[MetricBody] = None

    @model_validator(mode="after")
    def _check(self) -> "MetricSection":
        if self.state == "ok":
            if self.body is None or self.missing_reason is not None:
                raise ValueError("ok 섹션은 body 필수, missing_reason 불가")
        else:
            if self.body is not None or self.missing_reason is None:
                raise ValueError("missing 섹션은 body 없음, missing_reason 필수")
        return self


# ── 다음 걸음 / 방법 ──────────────────────────────────────────────
class NextStep(_Strict):
    title: str
    body: str


class NextSteps(_Strict):
    eyebrow: str
    title: str
    body: str
    items: list[NextStep]


class MemoPage(_Strict):
    eyebrow: str
    title: str
    prompt: str
    labels: list[str]


class Reference(_Strict):
    text: str


class Method(_Strict):
    eyebrow: str
    title: str
    body: str
    reading_title: str
    paragraphs: list[str]
    footnote: str
    references_title: str
    references: list[Reference]
    references_checked: str
    contact_title: str
    contact_body: str  # "문의: 담당 클래스 코치" 포함


class BackCover(_Strict):
    kicker: str
    title: str  # 줄바꿈 \n
    subtitle: str
    brand: str
    note: str
    contact: str


class Cover(_Strict):
    kicker: str
    title: str  # 줄바꿈 \n
    tagline: str
    rows: list[tuple[str, str]]  # (라벨, 값)
    brand: str
    footer: str
    issued_note: str


class Toc(_Strict):
    heading: str
    chapter_title: str
    chapter_subtitle: str
    next_chapter_note: str
    guide: str


class MemberReport(_Strict):
    schema_version: Literal["member_report.v1"] = SCHEMA_VERSION
    meta: MemberMeta
    cover: Cover
    toc: Toc
    hero: Hero
    opinion: Opinion
    journey: Optional[Journey] = None  # 미착용이면 None
    stable5: Optional[Stable5] = None  # 결측이면 None → 7쪽 생략
    metrics: dict[MetricKey, MetricSection]  # 미착용이면 빈 dict 허용, aperiodic 키 없음도 허용
    next_steps: NextSteps
    memo: MemoPage
    method: Method
    back: BackCover
    forbidden_words_checked: bool = True

    @model_validator(mode="after")
    def _check(self) -> "MemberReport":
        if self.meta.band_status == "not_worn":
            for sec in self.metrics.values():
                if sec.state != "missing" or sec.missing_reason != "band_not_worn":
                    raise ValueError("미착용 회원의 지표는 band_not_worn 결측이어야 함")
        for k, sec in self.metrics.items():
            if sec.key != k:
                raise ValueError("metrics 키와 섹션 key 불일치")
        return self


# ── 책 쪽 구성(파생 규칙) ──────────────────────────────────────────
class BookPage(_Strict):
    page: int
    key: PageKey
    title: str


class TocEntry(_Strict):
    label: str
    start: int
    end: int


class BookPageMap(_Strict):
    total: int
    pages: list[BookPage]
    toc: list[TocEntry]


_BODY_ORDER: list[tuple[PageKey, str]] = [
    ("journey", "몸의 변화 · 수업 여정"), ("motion", "몸의 움직임"), ("stable5", "안정된 5분"),
    ("heart_rate", "심박수"), ("rmssd", "RMSSD"), ("lf_hf", "LF/HF 흐름"),
]
_MIND_ORDER: list[tuple[PageKey, str]] = [
    ("focus", "마음의 변화 · 집중도"), ("relaxation", "이완도"),
    ("emotional_balance", "감정 균형도"), ("aperiodic", "뇌파 1/f 기울기"),
]
_NUM_KO = {1: "하나", 2: "두", 3: "세", 4: "네", 5: "다섯", 6: "여섯"}


def _page_present(report: MemberReport, key: PageKey) -> bool:
    if key == "journey":
        return report.journey is not None
    if key == "stable5":
        return report.stable5 is not None
    sec = report.metrics.get(key)  # type: ignore[arg-type]
    return sec is not None and sec.state == "ok"


def expected_book_pages(report: MemberReport) -> BookPageMap:
    """결측 지표 쪽을 생략하고 쪽번호·목차를 재계산하는 정본 규칙(T6가 구현할 동작의 기준).

    - 지표 쪽은 정확히 1쪽, 결측 지표는 "측정되지 않았어요" 대체 쪽 없이 쪽 자체를 생략
    - 표지·목차·요약·종합 의견·다음 걸음·메모·방법·뒷표지는 항상 포함
    """
    pages: list[tuple[PageKey, str]] = [  # noqa: 아래 += 는 같은 타입
        ("cover", "표지"), ("toc", "목차"), ("summary", "요약 카드 · 지금 나의 상태"), ("opinion", "종합 의견"),
    ]
    body = [p for p in _BODY_ORDER if _page_present(report, p[0])]
    mind = [p for p in _MIND_ORDER if _page_present(report, p[0])]
    pages += body + mind
    pages += [("next_steps", "다음 걸음"), ("memo", "손글씨 메모"), ("method", "방법 · 참고문헌 · 문의"),
              ("back", "뒷표지")]
    numbered = [BookPage(page=i + 1, key=k, title=t) for i, (k, t) in enumerate(pages)]
    pos = {p.key: p.page for p in numbered}

    toc: list[TocEntry] = [
        TocEntry(label="요약 카드 · 지금 나의 상태", start=pos["summary"], end=pos["summary"]),
        TocEntry(label="종합 의견", start=pos["opinion"], end=pos["opinion"]),
    ]
    if body:
        n = len([p for p in body if p[0] != "journey"])
        label = "몸의 변화 · 수업 여정" + (f"과 {_NUM_KO[n]} 지표" if n else "")
        toc.append(TocEntry(label=label, start=pos[body[0][0]], end=pos[body[-1][0]]))
    if mind:
        toc.append(TocEntry(label=f"마음의 변화 · {_NUM_KO[len(mind)]} 지표",
                            start=pos[mind[0][0]], end=pos[mind[-1][0]]))
    for key, label in (("next_steps", "다음 걸음"), ("memo", "손글씨 메모"),
                       ("method", "방법 · 참고문헌 · 문의"), ("back", "뒷표지")):
        toc.append(TocEntry(label=label, start=pos[key], end=pos[key]))
    return BookPageMap(total=len(numbered), pages=numbered, toc=toc)
