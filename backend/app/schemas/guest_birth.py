"""비회원 생년월 수집. 기존 DATE 컬럼의 일자는 실제 생일을 뜻하지 않는다."""
import re
from datetime import date


def parse_guest_birth_year_month(value: str) -> date:
    """연·월만 검증하고 저장 호환을 위해 해당 월 1일로 정규화한다."""
    if not re.fullmatch(r'[0-9]{4}-[0-9]{2}', value):
        raise ValueError('생년월은 YYYY-MM 형식으로 입력해 주세요')
    birth = date.fromisoformat(f'{value}-01')
    if birth > date.today().replace(day=1):
        raise ValueError('미래 생년월은 입력할 수 없습니다')
    return birth
