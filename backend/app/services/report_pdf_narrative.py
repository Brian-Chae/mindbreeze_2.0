"""SDD-070: 웹 narrative/resolve-narrative 표시 계약의 Python 이식."""
import math
import re

METRIC_LABELS = {
  "respiratory_rate": '호흡수',
  "heart_rate": '심박수',
  "hrv": '심박변이(심장 박동 간격의 변화)',
  "focus": '집중도',
  "relaxation": '이완도',
  "emotional_stability": '감정안정도',
}

SENTENCE_TEMPLATES = {
  "respiratory_rate": {
    "down": '호흡이 느려졌어요',
    "stable": '호흡이 고르게 유지됐어요',
    "up": '호흡이 빨라졌어요',
  },
  "heart_rate": {
    "down": '심장이 차분해졌어요',
    "stable": '심박이 일정했어요',
    "up": '심박이 빨라졌어요',
  },
  "hrv": {
    "down": '심장 박동 간격의 변화가 줄었어요',
    "stable": '심장 박동 간격의 변화가 비슷했어요',
    "up": '심장 박동 간격의 변화가 늘었어요',
  },
  "focus": {
    "down": '집중이 흔들렸어요',
    "stable": '집중이 유지됐어요',
    "up": '집중이 깊어졌어요',
  },
  "relaxation": {
    "down": '긴장이 남아 있었어요',
    "stable": '이완이 유지됐어요',
    "up": '이완이 깊어졌어요',
  },
  "emotional_stability": {
    "down": '마음의 안정과 관련된 신호가 낮아졌어요',
    "stable": '마음의 안정과 관련된 신호가 유지됐어요',
    "up": '마음의 안정과 관련된 신호가 높아졌어요',
  },
}

JOURNEY_TEMPLATES = {
  "relax": {
    "calm": '몸은 점차 이완으로, 마음은 차분한 안정으로 흘렀습니다.',
    "scatter": '몸은 점차 이완으로, 마음은 산만함과 함께 흘렀습니다.',
    "stable": '몸은 점차 이완으로, 마음은 고르게 유지되었습니다.',
  },
  "arouse": {
    "calm": '몸은 각성 쪽으로, 마음은 차분한 안정으로 흘렀습니다.',
    "scatter": '몸은 각성 쪽으로, 마음은 산만함과 함께 흘렀습니다.',
    "stable": '몸은 각성 쪽으로, 마음은 고르게 유지되었습니다.',
  },
  "stable": {
    "calm": '몸은 고르게 유지되며, 마음은 차분한 안정으로 흘렀습니다.',
    "scatter": '몸은 고르게 유지되며, 마음은 산만함과 함께 흘렀습니다.',
    "stable": '몸과 마음 모두 고르게 유지되었습니다.',
  },
}

CLOSING_TEMPLATES = {
  "relax": {
    "calm": '오늘의 작은 쉼을 마음에 담고, 내일의 나에게도 같은 여유를 허락해 보세요.',
    "scatter": '몸이 느려진 감각을 기억하며, 마음이 흔들릴 때 호흡으로 돌아와 보세요.',
    "stable": '몸이 이완된 흐름을 기억하며, 일상에서도 짧은 멈춤을 이어가 보세요.',
  },
  "arouse": {
    "calm": '마음이 차분해진 감각을 붙잡고, 몸의 리듬도 천천히 맞춰 보세요.',
    "scatter": '오늘의 흐름을 있는 그대로 두고, 다음엔 호흡에 조금 더 머물러 보세요.',
    "stable": '몸의 각성을 부드럽게 내려놓고, 호흡의 속도에 주의를 두어 보세요.',
  },
  "stable": {
    "calm": '마음이 안정된 감각을 내일에도 이어가며, 짧은 호흡 명상을 이어가 보세요.',
    "scatter": '몸의 리듬은 유지됐으니, 다음에는 마음에 머무는 시간을 조금 더 가져 보세요.',
    "stable": '오늘처럼 고른 흐름을 기억하며, 짧은 쉼을 일상에 남겨 두세요.',
  },
}

METRIC_DEFINITIONS = {
  "respiratory_rate": '1분 동안 숨을 쉬는 횟수예요.',
  "heart_rate": '1분 동안 심장이 뛰는 횟수예요.',
  "hrv": '심장 박동 사이의 시간 간격이 얼마나 달라지는지 보여줘요. 밀리초는 1초의 1,000분의 1이에요.',
  "focus": '뇌파에서 주의를 기울이는 상태와 관련된 신호를 살펴봐요.',
  "relaxation": '뇌파에서 편안한 상태와 관련된 신호를 살펴봐요.',
  "emotional_stability": '마음의 안정과 관련된 신호예요. 그래프는 스트레스 신호를 반대로 읽은 추정값이며, 실제 감정을 직접 측정하지 않아요.',
}

IDS = tuple(METRIC_LABELS)
THRESHOLDS = {"respiratory_rate": 1, "heart_rate": 3, "hrv": 5}


def number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def simplify(text):
    text = re.sub(r'\bHRV\b', METRIC_LABELS['hrv'], text, flags=re.I)
    text = text.replace('세션', '명상 시간').replace('지표', '몸·마음 신호')
    text = re.sub(r'전반(?!적|부|\))', '명상 시작(전반)', text)
    text = re.sub(r'후반(?!부|\))', '마무리(후반)', text)
    text = re.sub(r'(\d)\s*ms\b', r'\1밀리초', text)
    return re.sub(r'(\d)\s*bpm\b', r'\1회/분', text, flags=re.I)


def build_metric_narrative(metric, early, late):
    raw = late - early
    delta = raw if metric in THRESHOLDS else ((raw / abs(early) * 100) if early else (0 if raw == 0 else 100 if raw > 0 else -100))
    threshold = THRESHOLDS.get(metric, 5)
    direction = 'stable' if abs(delta) < threshold else 'up' if delta > 0 else 'down'
    rounded = math.floor(delta * 10 + .5) / 10
    label = f'{abs(rounded):g}{"밀리초" if metric == "hrv" else "회/분"}' if metric in THRESHOLDS else f'{abs(math.floor(delta + .5))}%'
    return dict(id=metric, label=METRIC_LABELS[metric], direction=direction, delta=rounded,
                deltaLabel=label, arrow={'up': '↑', 'down': '↓', 'stable': '→'}[direction],
                sentence=SENTENCE_TEMPLATES[metric][direction])


def interpretation(metric):
    if metric['direction'] == 'stable':
        return '비슷하게 유지됐어요'
    preferred = 'down' if metric['id'] in ('respiratory_rate', 'heart_rate') else 'up'
    return '명상 중 참고하는 방향으로 좋아졌어요' if metric['direction'] == preferred else '변화에 주의가 필요해요'


def direction_guide(metric):
    if metric in ('respiratory_rate', 'heart_rate'):
        return '명상 중에는 감소(↓)를 차분해지는 방향으로 참고해요. 낮을수록 무조건 좋은 것은 아니에요.'
    if metric == 'hrv':
        return '명상 중에는 증가(↑)를 편안해지는 방향으로 참고해요. 높을수록 무조건 좋은 것은 아니에요.'
    return '명상 중에는 증가(↑)를 집중·안정에 가까워지는 방향으로 참고해요.'


def parse_timeline(raw):
    points = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        t = number(item.get('t'))
        minutes = t / 60 if t is not None else number(item.get('min'))
        if minutes is None:
            continue
        point = {'min': minutes}
        for key in ('concentration', 'relaxation', 'stress', 'heart_rate', 'respiratory_rate', 'sdnn', 'hrv'):
            value = number(item.get(key))
            if key in ('concentration', 'relaxation', 'stress') and value is not None and 0 <= value <= 1:
                value = math.floor(value * 1000 + .5) / 10
            point[key] = value
        points.append(point)
    return points


def metric_value(point, metric):
    if metric == 'hrv':
        return point.get('sdnn') if point.get('sdnn') is not None else point.get('hrv')
    value = point.get({'focus': 'concentration', 'emotional_stability': 'stress'}.get(metric, metric))
    return (1 if value <= 1 else 100) - value if metric == 'emotional_stability' and value is not None else value


def parse_changes(raw):
    result = {}
    for item in raw if isinstance(raw, list) else []:
        if isinstance(item, dict) and item.get('id') in IDS and number(item.get('early')) is not None and number(item.get('late')) is not None:
            result[item['id']] = (item['early'], item['late'])
    return result


def resolve_pdf_narrative(content):
    eeg = content.get('eeg') if isinstance(content.get('eeg'), dict) else {}
    if eeg.get('status') == 'not_measured':
        eeg = {}
    timeline = parse_timeline(eeg.get('timeline'))
    if not eeg:
        timeline = parse_timeline(content.get('eeg_timeline'))
    narrative = eeg.get('narrative') or content.get('narrative') or {}
    narrative = narrative if isinstance(narrative, dict) else {}
    changes = parse_changes(narrative.get('changes')) or parse_changes(eeg.get('changes'))
    if not changes and len(timeline) >= 2:
        mid = len(timeline) // 2
        for metric in IDS:
            halves = [[metric_value(p, metric) for p in half if metric_value(p, metric) is not None]
                      for half in (timeline[:mid], timeline[mid:])]
            if all(halves):
                changes[metric] = tuple(sum(values) / len(values) for values in halves)
    metrics = [build_metric_narrative(metric, *changes[metric]) for metric in IDS] if all(metric in changes for metric in IDS) else []
    body, mind = metrics[:3], metrics[3:]
    body_vote = sum((1 if m['direction'] == ('up' if m['id'] == 'hrv' else 'down') else -1) for m in body if m['direction'] != 'stable')
    mind_vote = sum(1 if m['direction'] == 'up' else -1 for m in mind if m['direction'] != 'stable')
    bt = 'relax' if body_vote > 0 else 'arouse' if body_vote < 0 else 'stable'
    mt = 'calm' if mind_vote > 0 else 'scatter' if mind_vote < 0 else 'stable'
    fields = {}
    for key in ('journey', 'body', 'mind', 'closing'):
        value = narrative.get(key) or narrative.get(key + '_text')
        fields[key] = simplify(value.strip()) if isinstance(value, str) and value.strip() else ''
    fields['journey'] = fields['journey'] or (JOURNEY_TEMPLATES[bt][mt] if metrics else '오늘의 몸과 마음 흐름을 살펴보세요.')
    fields['closing'] = fields['closing'] or (CLOSING_TEMPLATES[bt][mt] if metrics else '오늘의 작은 쉼을 마음에 담아 보세요.')
    return fields, body, mind, sorted((p for p in timeline if p['min'] >= 0), key=lambda p: p['min'])


def trend_svg(metric, timeline):
    """실측만 연결하며 웹과 동일한 범위와 결측 단절을 사용한다."""
    from html import escape
    duration = timeline[-1]['min'] if timeline else 0
    valid = [metric_value(p, metric) for p in timeline if metric_value(p, metric) is not None]
    if len(valid) < 2 or duration <= 0:
        return '<p class="chart-empty">추이를 분석할 데이터가 부족해요.</p>'
    ranges = {'respiratory_rate': (10, 20), 'heart_rate': (55, 90), 'hrv': (20, 80)}
    low, high = min(*valid, *ranges.get(metric, ())), max(*valid, *ranges.get(metric, ()))
    segments, last = [[]], None
    for point in timeline:
        value = metric_value(point, metric)
        if value is None:
            segments.append([])
            continue
        x, y = 16 + point['min'] / duration * 284, 88 if high == low else 158 - (value - low) / (high - low) * 140
        last = (x, y)
        segments[-1].append(f'{x:.1f},{y:.1f}')
    bands = ''.join(f'<rect x="16" y="{18 + i * 28}" width="284" height="28" fill="{color}" opacity=".24"/>' for i, color in enumerate(('#59CE90', '#93E5B9', '#E8E8E8', '#FFC9C7', '#F9746B')))
    lines = ''.join(f'<polyline points="{" ".join(segment)}" fill="none" stroke="#5F0080" stroke-width="2.8"/>' for segment in segments if len(segment) > 1)
    endpoint = f'<circle cx="{last[0]:.1f}" cy="{last[1]:.1f}" r="4" fill="#5F0080"/>' if last else ''
    caption = f'{low:g}~{high:g}{"밀리초" if metric == "hrv" else "회/분"} 범위' if metric in ranges else '상대적 높낮이 (개인 기준)'
    return f'<figure><svg viewBox="0 0 350 195"><title>{escape(METRIC_LABELS[metric])}의 명상 시간 중 변화</title>{bands}<path d="M158 18V158" stroke="#aaa" stroke-dasharray="3 5"/>{lines}{endpoint}<g fill="#63566B" font-size="11"><text x="310" y="40">높음</text><text x="310" y="92">보통</text><text x="310" y="148">낮음</text><text x="16" y="181">시작</text><text x="158" y="181" text-anchor="middle">{duration / 2:g}분</text><text x="300" y="181" text-anchor="end">{duration:g}분</text></g></svg><figcaption>{caption}</figcaption></figure>'


def render_cards(metrics, timeline, group):
    from html import escape
    if not metrics:
        return f'<p class="note">{group}의 신호 변화량이 아직 없어요.</p>'
    cards = []
    for m in metrics:
        badge = {'up': '증가', 'down': '감소', 'stable': '유지'}[m['direction']]
        cards.append(f'''<article class="metric-card"><div class="metric-copy"><h3>{escape(m['label'])} <span class="badge">{badge}</span></h3>
<p class="interpretation">{m['arrow']} {interpretation(m)}</p><p class="delta">{m['deltaLabel']}</p><p>{m['sentence']}</p>
<p class="definition">{METRIC_DEFINITIONS[m['id']]}</p><p class="guide">{direction_guide(m['id'])}</p>
<p class="caption">명상 시작(전반) 평균 대비 마무리(후반) 평균</p></div>{trend_svg(m['id'], timeline)}</article>''')
    return ''.join(cards)


def render_chips(body, mind):
    from html import escape
    chips = []
    for group, metrics in (('몸', body), ('마음', mind)):
        if metrics:
            labels = ' · '.join(f'{"심박변이" if m["id"] == "hrv" else m["label"].replace("안정도", "안정")} {m["arrow"]} {interpretation(m)}' for m in metrics)
            chips.append(f'<div class="summary-chip"><strong>{group}</strong> {escape(labels)}</div>')
    return '<div class="journey-summary">' + ''.join(chips) + '</div>'
