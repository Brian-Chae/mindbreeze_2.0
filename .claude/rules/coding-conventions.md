# 코딩 컨벤션

## TypeScript / React

- 파일명: `kebab-case.ts` / `.tsx`
- 컴포넌트: `PascalCase`
- 함수/변수: `camelCase`
- 상수: `UPPER_SNAKE_CASE`
- 인터페이스/타입: `PascalCase`
- `any` 사용 금지. 명시적 타입 또는 `unknown` + 타입 가드.
- 불변성: `array.map()` / `{...obj, key: val}` 사용. `push()` / `splice()` / 직접 할당 금지.

## Python / FastAPI

- 파일명: `snake_case.py`
- 함수/변수: `snake_case`
- 클래스: `PascalCase`
- 상수: `UPPER_SNAKE_CASE`
- 타입 힌트 필수: 모든 함수 시그니처에 명시.
- Pydantic v2: `model_validate()` 사용. `from_orm` → `from_attributes`.
- 비동기: `async def` + `await`. 동기 함수에서 블로킹 I/O 호출 금지.

## Git 커밋

```
<타입>: <한글 설명>

- 상세 내용 (선택)
```

타입: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`

예시:
```
feat: 세션 생성 API 및 내담자 초대 플로우 구현
fix: BLE 연결 해제 시 WebSocket 정리 누락 수정
```

## 주석

- 코드 식별자는 영문, 주석은 한글.
- 복잡한 비즈니스 로직은 Why를 설명.
- EEG 신호처리, 타임스탬프 변환 등 도메인 특수 로직은 연산식과 함께 주석.
