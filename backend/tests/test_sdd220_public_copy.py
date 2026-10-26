"""DB와 네트워크에 접속하지 않는 공개 템플릿 회귀 검사."""
import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = ['app/services/report_pdf_service.py', 'app/services/notification_service.py',
         'app/services/report_email_service.py', 'app/tasks/email.py']
TERMS = ('가격', '요금', '구독', '결제', '유료', '무료 체험', '무료로 시작하기', '업그레이드', '플랜', '구매', '진단', '치료', '처방', '효과 입증')
DISCLAIMER = '본 서비스와 LINK BAND는 의료기기가 아니며, 의학적 진단·치료·처방을 대신하지 않습니다.'


def violations(text):
    return [term for term in TERMS if term in text.replace(DISCLAIMER, '')]


def test_dictionary_rejects_unsafe_fixtures():
    assert violations('무료로 시작하기, 치료 효과 입증, 구독 요금')
    assert not violations(DISCLAIMER)


def test_public_templates_have_no_forbidden_copy():
    for name in FILES:
        tree = ast.parse((ROOT / name).read_text())
        # 주석과 함수 설명은 노출 본문이 아니다. 사용자 입력을 검사 대상으로 오인하지 않는다.
        for node in ast.walk(tree):
            if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                if node.body and isinstance(node.body[0], ast.Expr) and isinstance(node.body[0].value, ast.Constant) and isinstance(node.body[0].value.value, str):
                    node.body.pop(0)
        strings = [n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)]
        assert not violations(''.join(strings)), name


def test_pdf_carries_reference_notice():
    from app.services.report_pdf_service import render_report_html
    html = render_report_html({'content': {}})
    assert '추정 참고 지표' in html
    assert 'https://mindbreeze.looxidlabs.com/measurement-guide' in html
    assert DISCLAIMER in html
