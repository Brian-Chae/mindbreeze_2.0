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

def zone_of(score):
    if score >= 70:
        return 'high'
    if score >= 40:
        return 'mid'
    return 'low'

MIND_LEVEL_ADVERBS = {
    'emotional_stability': {
        'overall': {'high': '안정적으로', 'mid': '대체로', 'low': '불안정하게'},
        'early': {'high': '차분하게', 'mid': '대체로', 'low': '다소'},
        'late': {'high': '차분하게', 'mid': '안정적으로', 'low': '다소'},
    },
    'relaxation': {
        'overall': {'high': '깊게', 'mid': '대체로', 'low': '다소'},
        'early': {'high': '깊게', 'mid': '대체로', 'low': '다소'},
        'late': {'high': '더욱 깊게', 'mid': '안정적으로', 'low': '다소'},
    },
    'focus': {
        'overall': {'high': '깊게', 'mid': '대체로', 'low': '다소'},
        'early': {'high': '깊게', 'mid': '대체로', 'low': '다소'},
        'late': {'high': '더욱 깊게', 'mid': '안정적으로', 'low': '다소'},
    },
}

def mind_sentence(metric, overall, early, late, delta_label, direction):
    adv = MIND_LEVEL_ADVERBS[metric]
    o = adv['overall'][zone_of(overall)]
    e = adv['early'][zone_of(early)]
    l = adv['late'][zone_of(late)]
    verb = {'up': '상승', 'down': '하락', 'stable': '유지'}[direction]
    # PDF-NARR-001: 하락(down) 세션에 '찾았습니다/되찾았습니다' 같은 개선 어휘를 쓰면 모순이다.
    # 방향별로 마무리 어휘를 분기해 하락은 하락으로 서술한다.
    closing = {
        'emotional_stability': {
            'up': '안정을 찾았습니다',
            'stable': '안정을 유지했습니다',
            'down': '안정이 흔들렸습니다',
        },
        'relaxation': {
            'up': '편안함을 찾았습니다',
            'stable': '편안함을 유지했습니다',
            'down': '편안함이 줄었습니다',
        },
        'focus': {
            'up': '몰입을 되찾았습니다',
            'stable': '몰입을 유지했습니다',
            'down': '몰입이 흔들렸습니다',
        },
    }[metric][direction]
    if metric == 'emotional_stability':
        return f'전체적으로는 {o} 편안한 상태였고, 전반부에는 {e} 감정적으로 불안정했지만, 후반부에는 {l} {delta_label}만큼 {verb}하여 {closing}.'
    if metric == 'relaxation':
        return f'전체적으로는 {o} 이완된 상태였고, 전반부에는 {e} 긴장이 남아 있었지만, 후반부에는 {l} {delta_label}만큼 {verb}하여 {closing}.'
    return f'전체적으로는 {o} 집중된 상태였고, 전반부에는 {e} 산만했지만, 후반부에는 {l} {delta_label}만큼 {verb}하여 {closing}.'

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
    text = re.sub(r'PPG 기반 SDNN', METRIC_LABELS['hrv'], text, flags=re.I)
    text = re.sub(r'PPG 기반', '', text, flags=re.I)
    text = re.sub(r'\bSDNN\b|\bRMSSD\b', METRIC_LABELS['hrv'], text, flags=re.I)
    text = re.sub(r'정서적 안정|정서 안정', METRIC_LABELS['emotional_stability'], text, flags=re.I)
    text = text.replace('세션', '명상 시간').replace('지표', '몸·마음 신호')
    text = re.sub(r'전반(?!적|부|\))', '명상 시작(전반)', text)
    text = re.sub(r'후반(?!부|\))', '마무리(후반)', text)
    text = re.sub(r'(\d)\s*ms\b', r'\1밀리초', text)
    return re.sub(r'(\d)\s*bpm\b', r'\1회/분', text, flags=re.I)


def build_metric_narrative(metric, early, late, overall=None):
    raw = late - early
    # 방향 판단은 변화율 기준 유지(정규화 5% 임계, 단위는 지표별 임계)
    rate = (raw / abs(early) * 100) if early else (0 if raw == 0 else 100 if raw > 0 else -100)
    delta_for_direction = raw if metric in THRESHOLDS else rate
    threshold = THRESHOLDS.get(metric, 5)
    direction = 'stable' if abs(delta_for_direction) < threshold else 'up' if delta_for_direction > 0 else 'down'
    # 표시 변화량은 절대 차이(단위 지표는 단위, 정규화 지표는 포인트) — 변화율 %는 0 근처에서 왜곡
    rounded = math.floor(raw * 10 + .5) / 10
    label = f'{abs(rounded):g}{"밀리초" if metric == "hrv" else "회/분"}' if metric in THRESHOLDS else f'{abs(rounded):g}'
    ov = overall if overall is not None else (early + late) / 2
    if metric in ('focus', 'relaxation', 'emotional_stability'):
        sentence = mind_sentence(metric, ov, early, late, label, direction)
    else:
        sentence = SENTENCE_TEMPLATES[metric][direction]
    unit = {'hrv': '밀리초', 'respiratory_rate': '회/분', 'heart_rate': '회/분'}.get(metric, '점')
    return dict(id=metric, label=METRIC_LABELS[metric], direction=direction, overall=round(ov, 1),
                early=early, late=late, delta=rounded, deltaLabel=label,
                arrow={'up': '↑', 'down': '↓', 'stable': '→'}[direction], unit=unit,
                sentence=sentence)


def interpretation(metric):
    if metric['direction'] == 'stable':
        return '비슷하게 유지됐어요'
    preferred = 'down' if metric['id'] in ('respiratory_rate', 'heart_rate') else 'up'
    return '좋아졌어요' if metric['direction'] == preferred else '주의가 필요해요'


def direction_guide(metric):
    if metric in ('respiratory_rate', 'heart_rate'):
        return '명상 중에는 낮아지는(↓) 쪽이 차분해지는 신호예요.'
    if metric == 'hrv':
        return '명상 중에는 높아지는(↑) 쪽이 편안해지는 신호예요.'
    return '명상 중에는 높아지는(↑) 쪽이 집중·안정에 가까운 신호예요.'


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
            if key in ('concentration', 'relaxation', 'stress') and value is not None and 0 <= value < 1:
                value = math.floor(value * 1000 + .5) / 10
            point[key] = value
        points.append(point)
    return points


def metric_value(point, metric):
    if metric == 'hrv':
        return point.get('sdnn') if point.get('sdnn') is not None else point.get('hrv')
    value = point.get({'focus': 'concentration', 'emotional_stability': 'stress'}.get(metric, metric))
    if metric == 'emotional_stability' and value is not None:
        # PDF-METRIC-002: 감정안정도는 스트레스 신호의 역방향 근사다. parse_timeline 이 0~1 비율을
        # 0~100 으로 환산해 넘기므로 스트레스는 0~100 스케일이다. 종전
        # `(1 if value <= 1 else 100) - value` 는 낮은 스트레스(≤1)를 0~1 비율로 오인해
        # 역전(스트레스 0 → 안정도 ~1)시키고 경계(1)에서 불연속을 만들었다.
        # 0~100 으로 클램프한 뒤 100 - stress 로 연속 매핑한다(낮은 스트레스 = 높은 안정).
        return 100.0 - min(max(value, 0.0), 100.0)
    return value


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
            all_vals = [v for v in (metric_value(p, metric) for p in timeline) if v is not None]
            halves = [
                [v for v in (metric_value(p, metric) for p in half) if v is not None]
                for half in (timeline[:mid], timeline[mid:])
            ]
            if all(halves):
                overall = sum(all_vals) / len(all_vals)
                changes[metric] = tuple(sum(values) / len(values) for values in halves) + (overall,)
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


def _smooth(values, half):
    """웹 smoothSeries 와 동일한 중심 이동평균 — 결측(None)은 유지하고 건너뛴다."""
    out = [None] * len(values)  # type: list[float | None]
    n = len(values)
    for i, v in enumerate(values):
        if v is None:
            continue
        total = 0.0
        cnt = 0
        for j in range(max(0, i - half), min(n, i + half + 1)):
            x = values[j]
            if x is not None:
                total += x
                cnt += 1
        out[i] = total / cnt if cnt else None
    return out


def _axis_label(value):
    """y축 눈금값을 읽기 좋게 정리한다(정수면 정수, 아니면 소수 1자리)."""
    text = f'{value:.1f}'
    return text.rstrip('0').rstrip('.') if '.' in text else text


def trend_svg(metric, timeline):
    """실측만 연결하며 웹과 동일한 범위와 결측 단절·스무딩을 사용한다."""
    from html import escape
    duration = timeline[-1]['min'] if timeline else 0
    raw = [metric_value(p, metric) for p in timeline]
    valid = [v for v in raw if v is not None]
    if len(valid) < 2 or duration <= 0:
        return '<p class="chart-empty">추이를 분석할 데이터가 부족해요.</p>'
    half = max(2, round(len(valid) * 0.05))
    smoothed = _smooth(raw, half)
    ranges = {'respiratory_rate': (10, 20), 'heart_rate': (55, 90), 'hrv': (20, 80)}
    low, high = min(*valid, *ranges.get(metric, ())), max(*valid, *ranges.get(metric, ()))
    unit = {'hrv': '밀리초', 'respiratory_rate': '회/분', 'heart_rate': '회/분'}.get(metric, '점')
    # y축 눈금(단위 포함)을 왼쪽에 두기 위해 플롯 왼쪽 여백을 확보한다(웹 TrendLineChart와 동일).
    top, bottom, left, right = 18, 158, 48, 300
    mid = (left + right) // 2
    half_width = (right - left) // 2
    segments, last = [[]], None
    for idx, point in enumerate(timeline):
        value = smoothed[idx]
        if value is None:
            segments.append([])
            continue
        x = left + point['min'] / duration * (right - left)
        y = (top + bottom) / 2 if high == low else bottom - (value - low) / (high - low) * (bottom - top)
        last = (x, y)
        segments[-1].append(f'{x:.1f},{y:.1f}')
    lines = ''.join(f'<polyline points="{" ".join(segment)}" fill="none" stroke="#5F0080" stroke-width="2.8"/>' for segment in segments if len(segment) > 1)
    endpoint = f'<circle cx="{last[0]:.1f}" cy="{last[1]:.1f}" r="4" fill="#5F0080"/>' if last else ''
    return f'<figure><svg viewBox="0 0 350 195"><title>{escape(METRIC_LABELS[metric])}의 명상 시간 중 변화</title><rect x="{left}" y="{top}" width="{half_width}" height="{bottom - top}" fill="#f3eff7"/><rect x="{mid}" y="{top}" width="{half_width}" height="{bottom - top}" fill="#efe6f6"/><path d="M{mid} {top}V{bottom}" stroke="#c9bcd8" stroke-dasharray="3 5"/>{lines}{endpoint}<g fill="#63566B" font-size="10"><text x="{left - 6}" y="{top + 9}" text-anchor="end">{_axis_label(high)}{unit}</text><text x="{left - 6}" y="{bottom - 3}" text-anchor="end">{_axis_label(low)}{unit}</text></g><g fill="#63566B" font-size="11"><text x="{left}" y="181">시작</text><text x="{mid}" y="181" text-anchor="middle">{duration / 2:g}분</text><text x="{right}" y="181" text-anchor="end">{duration:g}분</text></g></svg><figcaption>명상 시간 중 {METRIC_LABELS[metric]} 흐름</figcaption></figure>'


def dual_bar_svg(m):
    """웹 DualBarChart 와 동일한 전반 vs 후반 이중 막대."""
    from html import escape
    max_map = {'respiratory_rate': 20, 'heart_rate': 90, 'hrv': 80, 'focus': 100, 'relaxation': 100, 'emotional_stability': 100}
    unit, mx = m['unit'], max_map[m['id']]
    early, late = m['early'], m['late']
    W, H, pad, barH, gap, labelW = 250, 92, 6, 22, 14, 32
    scale = W - 2 * pad - labelW - 50
    w1 = max(3, early / mx * scale)
    w2 = max(3, late / mx * scale)
    rowY1 = H / 2 - barH - gap / 2
    rowY2 = H / 2 + gap / 2
    return (f'<figure class="dual-bar"><svg viewBox="0 0 {W} {H}"><title>{escape(m["label"])} 전반 vs 후반 평균</title>'
            f'<text x="{pad}" y="{rowY1 + barH / 2:.0f}" font-size="10" fill="#6b6570">전반</text>'
            f'<rect x="{pad + labelW}" y="{rowY1}" width="{w1:.1f}" height="{barH}" rx="5" fill="#d9d2e2"/>'
            f'<text x="{pad + labelW + w1 + 6:.1f}" y="{rowY1 + barH / 2:.0f}" font-size="11" font-weight="700" fill="#2a2430">{early}{unit}</text>'
            f'<text x="{pad}" y="{rowY2 + barH / 2:.0f}" font-size="10" fill="#6b6570">후반</text>'
            f'<rect x="{pad + labelW}" y="{rowY2}" width="{w2:.1f}" height="{barH}" rx="5" fill="#5F0080"/>'
            f'<text x="{pad + labelW + w2 + 6:.1f}" y="{rowY2 + barH / 2:.0f}" font-size="11" font-weight="700" fill="#5F0080">{late}{unit}</text>'
            f'</svg><figcaption>전반 vs 후반</figcaption></figure>')


def render_cards(metrics, timeline, group):
    from html import escape
    if not metrics:
        return f'<p class="note">{group}의 신호 변화량이 아직 없어요.</p>'
    cards = []
    for m in metrics:
        badge = {'up': '증가', 'down': '감소', 'stable': '유지'}[m['direction']]
        sign = {'up': '+', 'down': '−', 'stable': ''}[m['direction']]
        dir_class = {'up': 'up', 'down': 'down', 'stable': 'flat'}[m['direction']]
        cards.append(f'''<article class="metric-card"><div class="metric-copy"><h3>{escape(m['label'])} <span class="badge">{badge}</span></h3>
<div class="avg-row"><span class="avg-value">{m['overall']:g}</span><span class="avg-unit">{m['unit']}</span><span class="avg-label">명상 전체 평균</span></div>
<div class="delta-row"><span>전반 <b>{m['early']:g}</b></span><span class="arrow">→</span><span>후반 <b>{m['late']:g}</b></span><span class="delta-pill {dir_class}">{sign}{abs(m['delta']):g}</span></div>
<p class="interpretation">{m['arrow']} {interpretation(m)}</p><p class="metric-sentence">{m['sentence']}</p>
<p class="definition">{METRIC_DEFINITIONS[m['id']]}</p><p class="guide">{direction_guide(m['id'])}</p>
<p class="caption">명상 시작(전반) 평균 대비 마무리(후반) 평균</p></div><div class="metric-charts">{dual_bar_svg(m)}{trend_svg(m['id'], timeline)}</div></article>''')
    return ''.join(cards)


def render_chips(body, mind):
    from html import escape
    chips = []
    for group, metrics in (('몸', body), ('마음', mind)):
        if metrics:
            labels = ' · '.join(f'{"심박변이" if m["id"] == "hrv" else m["label"].replace("안정도", "안정")} {m["arrow"]} {interpretation(m)}' for m in metrics)
            chips.append(f'<div class="summary-chip"><strong>{group}</strong> {escape(labels)}</div>')
    return '<div class="journey-summary">' + ''.join(chips) + '</div>'
