// SDD-209 M0 — FM04(코드 입력)·FM04b(개인정보 입력) 케이스 픽스처. 서버·로그인 없이 결정적으로 렌더한다.
import { createElement } from 'react';
import { CodeEntryView, type CodeEntryStatus } from '../../../../components/class/flow/member/CodeEntryView';
import { ProfileEntryView } from '../../../../components/class/flow/member/ProfileEntryView';
import type { EntryProfileDraft, EntryProfileErrors } from '../member-entry';
import type { FlowCaseContext, FlowCaseEntry } from '../types';
import { DEMO } from './member-common';

const noop = (): void => undefined;

interface CodeCase {
  digits: string;
  status: CodeEntryStatus;
  member: boolean;
  description: string;
}

const CODE_CASES: Record<string, CodeCase> = {
  default: { digits: '', status: 'idle', member: false, description: '기본 · 빈 입력' },
  filled: { digits: '004', status: 'idle', member: false, description: '입력 중 · 3자리' },
  'leading-zero': { digits: '0042', status: 'idle', member: false, description: '선행 0 코드 0042 · 4자리 완료' },
  error: { digits: '0047', status: 'error', member: false, description: '없는·틀린·종료 코드 동일 오류' },
  throttled: { digits: '0047', status: 'throttled', member: false, description: '시도 제한' },
  member: { digits: '0042', status: 'idle', member: true, description: '로그인 회원 · 계정 값으로 이어서 입장' },
};

const EMPTY: EntryProfileDraft = { name: '', gender: null, birth: '', email: '', emailConfirm: '' };
const FILLED: EntryProfileDraft = { name: DEMO.guestName, gender: 'female', birth: '1990-03', email: 'jieun@example.com', emailConfirm: 'jieun@example.com' };

interface ProfileCase {
  draft: EntryProfileDraft;
  errors: EntryProfileErrors;
  member: boolean;
  description: string;
}

const PROFILE_CASES: Record<string, ProfileCase> = {
  default: { draft: EMPTY, errors: {}, member: false, description: '기본 · 빈 폼(입장하기 비활성)' },
  filled: { draft: FILLED, errors: {}, member: false, description: '모두 입력' },
  error: {
    draft: { name: '', gender: 'female', birth: '1990.13', email: 'jieun@', emailConfirm: '' },
    errors: { name: '이름을 입력해 주세요', birth: '생년월을 다시 확인해 주세요', email: '이메일 형식을 확인해 주세요' },
    member: false,
    description: '필수 누락·형식 오류 인라인 문구',
  },
  mismatch: {
    draft: { ...FILLED, emailConfirm: 'jieun@exampel.com' },
    errors: { emailConfirm: '이메일이 서로 달라요' },
    member: false,
    description: '이메일 확인 불일치',
  },
  member: { draft: FILLED, errors: {}, member: true, description: '로그인 회원 · 계정 값 읽기 전용' },
};

export const flowCases: Record<string, FlowCaseEntry> = {};

for (const [key, c] of Object.entries(CODE_CASES)) {
  flowCases[`FM04:${key}`] = {
    description: c.description,
    render: (ctx: FlowCaseContext) =>
      createElement(CodeEntryView, {
        digits: c.digits, status: c.status, memberName: c.member ? DEMO.guestName : null, backdropSrc: ctx.backdropSrc,
        onChange: noop, onSubmit: noop, onBack: noop,
      }),
  };
}

for (const [key, c] of Object.entries(PROFILE_CASES)) {
  flowCases[`FM04b:${key}`] = {
    description: c.description,
    render: (ctx: FlowCaseContext) =>
      createElement(ProfileEntryView, {
        summary: { title: DEMO.title, startLabel: DEMO.startLabel, hostName: DEMO.host },
        mode: c.member ? 'member' : 'guest',
        draft: c.draft, errors: c.errors, submitError: null, submitting: false, backdropSrc: ctx.backdropSrc,
        onChange: noop, onSubmit: noop, onBack: noop,
      }),
  };
}
