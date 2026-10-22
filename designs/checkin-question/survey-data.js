// 현재 문항 정의에서 추출한 시안 전용 데이터. 숫자는 내부 선택 값이며 화면에 표시하지 않는다.
const surveyData = [
  {
    "axis": "arousal",
    "chip": "집중",
    "heading": "지금 집중은 어떤가요?",
    "options": [
      {
        "value": 1,
        "label": "매우 산만"
      },
      {
        "value": 2,
        "label": "산만"
      },
      {
        "value": 3,
        "label": "보통"
      },
      {
        "value": 4,
        "label": "집중"
      },
      {
        "value": 5,
        "label": "매우 집중"
      }
    ]
  },
  {
    "axis": "valence",
    "chip": "편안함",
    "heading": "지금 몸은 얼마나 편안한가요?",
    "options": [
      {
        "value": 1,
        "label": "매우 불편"
      },
      {
        "value": 2,
        "label": "불편"
      },
      {
        "value": 3,
        "label": "보통"
      },
      {
        "value": 4,
        "label": "편안"
      },
      {
        "value": 5,
        "label": "매우 편안"
      }
    ]
  },
  {
    "axis": "emotion",
    "chip": "감정",
    "heading": "지금 기분은 어떤가요?",
    "options": [
      {
        "value": 1,
        "label": "매우 부정적"
      },
      {
        "value": 2,
        "label": "부정적"
      },
      {
        "value": 3,
        "label": "보통"
      },
      {
        "value": 4,
        "label": "긍정적"
      },
      {
        "value": 5,
        "label": "매우 긍정적"
      }
    ]
  }
];
