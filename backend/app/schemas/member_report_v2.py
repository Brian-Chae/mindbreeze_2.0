"""SDD-328 T0 — 회원 개인 명상 리포트 v2(범용·실측 기반·쉬운 말) 데이터 계약.

`reports.content.member_report`(JSONB)에 `schema_version="member_report.v2"` 로 저장된다(v1 과 분기).
- FE 사본: `frontend/src/lib/member-report/types-v2.ts` (수동 동기화 + 드리프트 테스트)
- 골든 픽스처: `backend/tests/fixtures/member_report_v2/*.json` (합성·익명, FE `__fixtures__/v2/` 와 동일 바이트)
- v1(`schemas/member_report.py`)은 수정하지 않는다. 변경 없는 보조 모델·상수는 v1 에서 import 해 재사용한다.

v1 대비 변경 요지
- 수업 구간(`segments`·`my_segments`·`SegmentCompareRow`) 폐기 → 처음 5분 / 마지막 5분 / 가장 편안했던 5분(후보)
- 그룹 띠: 중앙+50/80% 분위수(`GroupBand`) 폐기 → 분별 평균 ± 1 표준편차(모집단, ddof=0) + 유효 인원(n)
- HRV(RMSSD)는 상대 변화(%)만, 절대값(ms)·연령 참고 범위 없음. SDNN 은 `quiet5` 쪽에서만 상대 변화로 노출
- `stable5`(안정된 5분, 참고 띠 3종) → `quiet5`(가장 편안했던 5분)
- 모든 문장은 규칙·문장 틀로 생성(`narrative.source` 는 항상 "rule"), AI 호출 0

표기 규칙
- 모든 "분"은 수업 시작 기준 **1부터 시작하는 표기 분**(1분째). 배열 인덱스 i 는 표기 분 i+1.
- 안착 제외: 표기 1·2분(`settle_minutes=2`). 처음 5분 = 표기 3~7분, 마지막 5분 = 표기 n-4~n분(n=`last_minute`).
- 큰 글씨(제목·히어로·카드·쪽 제목·본문)에는 전문 용어(RMSSD·SDNN·HRV·LF/HF·PRV·심박수)를 쓰지 않는다.
  원어는 `footnote` 필드에만 허용한다(계약 테스트가 필드 화이트리스트로 검사).

결측 표현(0으로 채우지 않는다, 보간하지 않는다)
- 밴드 미착용            → `band_status="not_worn"`, 모든 지표 섹션 `state="missing"(band_not_worn)`
- 지표 신호 부족          → 섹션 `state="missing"`, `missing_reason="poor_signal"`
- 상대 변화 기준값(처음 5분 중앙값) 결측·0 이하 → 해당 지표 `missing(poor_signal)`
- 1/f 산출 불가           → `metrics.aperiodic.state="missing"` + `no_raw|insufficient_window|poor_fit` (키 없음도 동일)
- 그룹 유효 인원 < MIN_GROUP_N → 그 분의 `mean`·`sd` 는 None(선·띠 끊김), 전체가 그렇다면 `group=None` + `group_hidden_reason="min_n"`
- 시계열 결측 분           → 배열 원소 None (선을 끊는다)
- 10분 미만 측정(`short_measure`) → `first_window`·`last_window`·`change` 없음, 평균·흐름만
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, model_validator

# v1 에서 변경 없이 재사용(수정 금지)
from app.schemas.member_report import (  # noqa: F401  (재노출)
    MIN_GROUP_N,
    MIN_VALID_MINUTES,
    BackCover,
    BandStatus,
    Cover,
    Direction,
    EffectPair,
    MemoPage,
    Method,
    MetricState,
    MissingReason,
    Narrative,
    NextSteps,
    Reference,
    Tone,
    Toc,
)

SCHEMA_VERSION = "member_report.v2"
SETTLE_MINUTES = 2  # 밴드 안착 시간(표기 1·2분) — 비교·요약에서 제외
WINDOW_MINUTES = 5  # 처음/마지막/가장 편안했던 구간 길이

MetricKey = Literal["motion", "heart_rate", "rmssd", "lf_hf", "focus", "relaxation", "emotional_balance", "aperiodic"]
ValueTransform = Literal["linear", "log1p", "pct_vs_first5"]
ChangeKind = Literal["abs", "pct", "flow"]
WhenLabel = Literal["수업 초반에", "수업 중간에", "수업이 끝나갈 무렵"]
PageKey = Literal[
    "cover", "toc", "summary", "opinion", "journey", "motion", "quiet5", "heart_rate", "rmssd",
    "lf_hf", "focus", "relaxation", "emotional_balance", "aperiodic", "next_steps", "memo", "method", "back",
]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ── 메타 ───────────────────────────────────────────────────────────
class Window(_Strict):
    """표기 분(1부터), 양끝 포함. 길이는 항상 WINDOW_MINUTES."""

    start: int
    end: int

    @model_validator(mode="after")
    def _check(self) -> "Window":
        if self.end - self.start + 1 != WINDOW_MINUTES:
            raise ValueError("구간 길이는 5분이어야 함")
        return self


class MemberMetaV2(_Strict):
    member_code: str  # 회원 식별 코드 — 실명 금지
    program_label: str  # 프로그램 이름은 라벨로만 쓴다(구성 분기 없음)
    chapter_label: str
    session_date: str  # YYYY-MM-DD
    start_clock: str  # HH:MM
    device_text: str
    basis_text: str
    reference_group_text: Optional[str] = None
    issued_on: str  # YYYY-MM-DD
    volume_label: str
    band_status: BandStatus
    settle_minutes: int = SETTLE_MINUTES
    first_minute: int = 1  # 표기 분
    last_minute: int  # 표기 분 = 유효 측정 길이 n
    valid_minutes: int  # 안착 이후 실제 값이 있는 분 수(개인 기준)
    first_window: Optional[Window] = None  # short_measure 면 None
    last_window: Optional[Window] = None
    short_measure: bool = False
    group_n: Optional[int] = None  # 그룹 인원(회원 본인 제외)

    @model_validator(mode="after")
    def _check(self) -> "MemberMetaV2":
        if self.settle_minutes != SETTLE_MINUTES:
            raise ValueError("settle_minutes 는 2 로 고정")
        if self.short_measure:
            if self.first_window is not None or self.last_window is not None:
                raise ValueError("짧은 측정은 전후 구간이 없어야 함")
        elif self.band_status == "worn":
            if self.first_window is None or self.last_window is None:
                raise ValueError("전후 구간 필요")
            if self.first_window.start != SETTLE_MINUTES + 1:
                raise ValueError("처음 5분은 표기 3분부터")
            if self.last_window.end != self.last_minute:
                raise ValueError("마지막 5분은 last_minute 에서 끝나야 함")
        return self


# ── 요약·종합 의견·여정 ────────────────────────────────────────────
class QuietHighlight(_Strict):
    text: str  # "수업 중간에(12~16분) 가장 편안했던 5분을 찾았어요."
    note: str  # 후보 문구 — 편안함을 확정하지 않는다


class HeroV2(_Strict):
    kicker: str
    headline: str  # 줄바꿈 \n
    lead: str
    pair_caption_before: Optional[str] = None  # "처음 · 3~7분"
    pair_caption_after: Optional[str] = None
    pairs: list[EffectPair]  # 짧은 측정·미착용이면 빈 배열
    caution: Optional[str] = None
    other_directions: Optional[str] = None
    quiet_highlight: Optional[QuietHighlight] = None
    note: Optional[str] = None  # 안착·수업 안 변화 안내


class Observation(_Strict):
    title: str
    body: str


class OpinionV2(_Strict):
    narrative: Narrative  # source 는 항상 "rule"
    observations: list[Observation]  # 오늘의 관찰 3가지
    interpret_title: str
    interpret_body: str
    chart_keys: list[MetricKey]  # 종합 의견 쪽 하단 미니 그래프(데이터는 metrics 재사용)
    legend_note: str
    footnote: Optional[str] = None


class TimelineItem(_Strict):
    label: str  # "처음 5분 · 3~7분"
    value: str  # "75.0회/분" / "12~16분 · 움직임으로 찾은 후보"


class JourneyV2(_Strict):
    eyebrow: str
    title: str
    timeline: list[TimelineItem]
    chart_keys: list[MetricKey]  # motion 대형 + 보조 2종
    legend_note: str
    interpret_title: str
    interpret_body: str


# ── 가장 편안했던 5분 ──────────────────────────────────────────────
class QuietDeltas(_Strict):
    heart_rate: Optional[float] = None  # 처음 5분 대비 회/분 차(음수=감소)
    rmssd_pct: Optional[float] = None  # 처음 5분 대비 상대 변화 %
    sdnn_pct: Optional[float] = None


class QuietItem(_Strict):
    title: str  # 쉬운 말 제목
    value_text: str  # "57.9 회/분" / "12.2% 증가"
    body: str
    footnote: Optional[str] = None  # 원어(RMSSD·SDNN) 허용 위치


class Quiet5(_Strict):
    start_min: int  # 표기 분
    end_min: int
    when_label: WhenLabel
    eyebrow: str
    title: str  # "수업 중간에(12~16분) 가장 편안했던 5분을 찾았어요."
    note: str  # 후보 문구
    hr_median: float
    deltas: QuietDeltas
    items: list[QuietItem]
    reading_title: str
    reading_body: str

    @model_validator(mode="after")
    def _check(self) -> "Quiet5":
        if self.end_min - self.start_min + 1 != WINDOW_MINUTES:
            raise ValueError("편안한 구간은 5분")
        if self.start_min <= SETTLE_MINUTES:
            raise ValueError("안착 시간(첫 2분)은 후보에서 제외")
        return self


# ── 지표 섹션 ──────────────────────────────────────────────────────
class GroupBandV2(_Strict):
    """분별 그룹 평균 ± 1 표준편차(모집단 SD). 유효 인원 < MIN_GROUP_N 인 분은 mean·sd = None."""

    mean: list[Optional[float]]
    sd: list[Optional[float]]
    n: list[int]  # 해당 분 유효 인원(본인 제외). 0 허용

    @model_validator(mode="after")
    def _check(self) -> "GroupBandV2":
        if not (len(self.mean) == len(self.sd) == len(self.n)):
            raise ValueError("그룹 띠 길이 불일치")
        for m, s, n in zip(self.mean, self.sd, self.n):
            shown = n >= MIN_GROUP_N
            if shown != (m is not None) or shown != (s is not None):
                raise ValueError("n<10 인 분은 평균·SD 를 모두 숨기고, n>=10 이면 모두 보여야 함")
        return self


class SeriesV2(_Strict):
    minutes: list[int]  # 표기 분(1..last_minute)
    values: Optional[list[Optional[float]]] = None  # 나의 매분 값, 결측 None
    norm: Optional[list[Optional[float]]] = None  # 0~1 축 높이(lf_hf log1p). values 없을 때 필수
    value_transform: ValueTransform = "linear"
    axis_min: Optional[float] = None
    axis_max: Optional[float] = None
    axis_unit: str
    settle_shade: bool = True  # 첫 2분 회색 배경
    group_band: Optional[GroupBandV2] = None  # 그룹 숨김·lf_hf 이면 None

    @model_validator(mode="after")
    def _check(self) -> "SeriesV2":
        n = len(self.minutes)
        if self.values is None and self.norm is None:
            raise ValueError("values 또는 norm 중 하나는 필요")
        for arr in (self.values, self.norm):
            if arr is not None and len(arr) != n:
                raise ValueError("시계열 길이 불일치")
        if self.group_band is not None and len(self.group_band.mean) != n:
            raise ValueError("그룹 띠 길이 불일치")
        if self.group_band is not None:
            for i in range(min(SETTLE_MINUTES, n)):
                if self.group_band.mean[i] is not None:
                    raise ValueError("안착 시간 분에는 그룹 평균을 두지 않음")
        return self


class ChangeV2(_Strict):
    kind: ChangeKind
    direction: Direction
    label: str  # 쉬운 말 이름
    unit: str
    decimals: int
    before: Optional[float] = None  # kind=abs·flow
    after: Optional[float] = None
    delta: Optional[float] = None  # kind=abs
    pct: Optional[float] = None  # kind=pct — 처음 5분 대비 마지막 5분 %

    @model_validator(mode="after")
    def _check(self) -> "ChangeV2":
        if self.kind == "abs" and (self.before is None or self.after is None or self.delta is None):
            raise ValueError("abs 변화는 before/after/delta 필요")
        if self.kind == "pct" and self.pct is None:
            raise ValueError("pct 변화는 pct 필요")
        if self.kind == "flow" and (self.before is None or self.after is None):
            raise ValueError("flow 변화는 before/after(방향 판정용) 필요")
        return self


class DistributionV2(_Strict):
    """개인 분 값 히스토그램 + 그룹 분 값 가우시안 KDE + 평균선 + ±1SD 음영(집계만)."""

    lo: float
    hi: float
    axis_ticks: list[float]  # 3개 (lo, 중간, hi)
    mean_me: float
    mean_group: float
    sd_group: float  # 모집단 SD (ddof=0)
    n_people: int  # 본인 제외 그룹 인원
    n_person_minutes: int
    my_minutes: int
    density: list[float]  # 81점 격자 KDE, 공통 최대값으로 0~1 정규화
    my_bars: list[float]  # 24구간 히스토그램, density 와 같은 정규화


class GroupBlockV2(_Strict):
    title: str
    paragraphs: list[str]
    distribution: DistributionV2
    legend: str
    footnote: Optional[str] = None


class Companion(_Strict):
    """lf_hf 처럼 그룹 비교 대신 다른 신호와 함께 읽는 보조 블록."""

    title: str
    body: str


class MetricBodyV2(_Strict):
    eyebrow: str
    conclusion: str  # 한 줄 결론(쉬운 말)
    bridge: Optional[str] = None  # "처음 5분(3~7분)과 마지막 5분(62~66분)을 비교했어요."
    comparison_text: Optional[str] = None  # 그래프 머리 "처음 5분 → 마지막 5분 · 75.0 → 58.0 회/분"
    first: Optional[float] = None  # 처음 5분 중앙값(상대 변화 지표는 기준이므로 0.0)
    last: Optional[float] = None
    quiet: Optional[float] = None  # 가장 편안했던 5분 중앙값(해당 없으면 None)
    change: Optional[ChangeV2] = None  # short_measure 이면 None
    overall_mean: Optional[float] = None  # short_measure 일 때 안착 이후 평균
    decimals: Optional[int] = None
    series: SeriesV2
    series_legend: str
    interpret: str  # 이게 무슨 뜻이에요
    reading: Optional[str] = None  # 이렇게 읽어요
    group: Optional[GroupBlockV2] = None
    group_hidden_reason: Optional[Literal["min_n"]] = None
    companion: Optional[Companion] = None
    footnote: Optional[str] = None  # 원어(RMSSD·SDNN·LF/HF)·산출 근거 허용 위치

    @model_validator(mode="after")
    def _check(self) -> "MetricBodyV2":
        if self.group is None and self.series.group_band is not None:
            raise ValueError("그룹 숨김 시 group_band 도 숨겨야 함(숫자 미전송)")
        if self.group is not None and self.group_hidden_reason is not None:
            raise ValueError("그룹이 있으면 숨김 사유 불가")
        return self


class MetricSectionV2(_Strict):
    key: MetricKey
    title: str  # 쉬운 말 쪽 제목
    chapter: Literal["body", "mind"]
    state: MetricState
    missing_reason: Optional[MissingReason] = None
    body: Optional[MetricBodyV2] = None

    @model_validator(mode="after")
    def _check(self) -> "MetricSectionV2":
        if self.state == "ok":
            if self.body is None or self.missing_reason is not None:
                raise ValueError("ok 섹션은 body 필수, missing_reason 불가")
        else:
            if self.body is not None or self.missing_reason is None:
                raise ValueError("missing 섹션은 body 없음, missing_reason 필수")
        return self


class MemberReportV2(_Strict):
    schema_version: Literal["member_report.v2"] = SCHEMA_VERSION
    meta: MemberMetaV2
    cover: Cover
    toc: Toc
    hero: HeroV2
    opinion: OpinionV2
    journey: Optional[JourneyV2] = None  # 미착용이면 None
    quiet5: Optional[Quiet5] = None  # 후보 없음·결측이면 None → 쪽 생략
    metrics: dict[MetricKey, MetricSectionV2]  # 미착용이면 빈 dict 허용, aperiodic 키 없음도 허용
    next_steps: NextSteps
    memo: MemoPage
    method: Method
    back: BackCover
    forbidden_words_checked: bool = True

    @model_validator(mode="after")
    def _check(self) -> "MemberReportV2":
        if self.meta.band_status == "not_worn":
            for sec in self.metrics.values():
                if sec.state != "missing" or sec.missing_reason != "band_not_worn":
                    raise ValueError("미착용 회원의 지표는 band_not_worn 결측이어야 함")
        for k, sec in self.metrics.items():
            if sec.key != k:
                raise ValueError("metrics 키와 섹션 key 불일치")
        if self.opinion.narrative.source != "rule":
            raise ValueError("v2 는 AI 문장을 쓰지 않는다(source=rule)")
        if self.meta.short_measure and self.hero.pairs:
            raise ValueError("짧은 측정은 전후 pair 없음")
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
    ("journey", "몸의 변화 · 수업 여정"), ("motion", "몸이 움직인 정도"), ("quiet5", "가장 편안했던 5분"),
    ("heart_rate", "1분 동안 뛴 횟수"), ("rmssd", "심장 리듬의 여유"), ("lf_hf", "긴장과 휴식의 균형"),
]
_MIND_ORDER: list[tuple[PageKey, str]] = [
    ("focus", "마음의 변화 · 집중도"), ("relaxation", "이완도"),
    ("emotional_balance", "감정 균형도"), ("aperiodic", "뇌파 1/f 기울기"),
]
_NUM_KO = {1: "하나", 2: "두", 3: "세", 4: "네", 5: "다섯", 6: "여섯"}


def _page_present(report: MemberReportV2, key: PageKey) -> bool:
    if key == "journey":
        return report.journey is not None
    if key == "quiet5":
        return report.quiet5 is not None
    sec = report.metrics.get(key)  # type: ignore[arg-type]
    return sec is not None and sec.state == "ok"


def expected_book_pages_v2(report: MemberReportV2) -> BookPageMap:
    """결측 쪽을 생략하고 쪽번호·목차를 재계산하는 정본 규칙(v1 `expected_book_pages` 와 같은 방식).

    - 지표 쪽은 정확히 1쪽, 결측 지표·후보 없는 편안한 5분은 대체 쪽 없이 생략
    - 표지·목차·요약·종합 의견·다음 걸음·메모·방법·뒷표지는 항상 포함
    """
    pages: list[tuple[PageKey, str]] = [  # noqa: 아래 += 는 같은 타입
        ("cover", "표지"), ("toc", "목차"), ("summary", "요약 카드 · 지금 나의 변화"), ("opinion", "종합 의견"),
    ]
    body = [p for p in _BODY_ORDER if _page_present(report, p[0])]
    mind = [p for p in _MIND_ORDER if _page_present(report, p[0])]
    pages += body + mind
    pages += [("next_steps", "다음 걸음"), ("memo", "손글씨 메모"), ("method", "방법 · 참고문헌 · 문의"),
              ("back", "뒷표지")]
    numbered = [BookPage(page=i + 1, key=k, title=t) for i, (k, t) in enumerate(pages)]
    pos = {p.key: p.page for p in numbered}

    toc: list[TocEntry] = [
        TocEntry(label="요약 카드 · 지금 나의 변화", start=pos["summary"], end=pos["summary"]),
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
