import { describe, expect, it } from 'vitest';
import { liveDiagCode, setLiveDiag } from '../src/lib/session-live/live-diag';

describe('live 소켓 진단 코드', () => {
  it('상태를 짧은 코드로 만들고 민감할 수 있는 문자를 걸러낸다', () => {
    setLiveDiag({ active: true, flag: true, created: true, connected: false, phase: 'JOINING', err: 'ce_websocket error: https://x?token=abc' });
    const c = liveDiagCode();
    expect(c).toMatch(/^a1\.f1\.s1\.c0\.pjoining\.eother$/);
    expect(c).not.toMatch(/[?&=:/ ]/);
  });
  it('허용 목록의 오류 코드만 통과한다', () => {
    setLiveDiag({ err: 'ce_token_expired' });
    expect(liveDiagCode()).toMatch(/\.ece_token_expired$/);
    setLiveDiag({ err: 'ce_websocket error' });
    expect(liveDiagCode()).toMatch(/\.ece_websocket_error$/);
    setLiveDiag({ err: '-' });
    expect(liveDiagCode()).toMatch(/\.e-$/);
  });
  it('임의 문자열(토큰·이메일 형태)은 ld 에 들어가지 않는다', () => {
    for (const raw of ['ce_token=exampleSecret123', 'ce_user@example.com', 'ce_eyJhbGciOiJIUzI1NiJ9.abc.def', 'create_Secret9Name']) {
      setLiveDiag({ err: raw });
      const c = liveDiagCode();
      expect(c).toMatch(/\.eother$/);
      expect(c.toLowerCase()).not.toMatch(/secret|example|eyj|user/);
    }
  });
});
