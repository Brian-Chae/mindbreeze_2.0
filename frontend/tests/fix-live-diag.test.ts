import { describe, expect, it } from 'vitest';
import { liveDiagCode, setLiveDiag } from '../src/lib/session-live/live-diag';

describe('live 소켓 진단 코드', () => {
  it('상태를 짧은 코드로 만들고 민감할 수 있는 문자를 걸러낸다', () => {
    setLiveDiag({ active: true, flag: true, created: true, connected: false, phase: 'JOINING', err: 'ce_websocket error: https://x?token=abc' });
    const c = liveDiagCode();
    expect(c).toMatch(/^a1\.f1\.s1\.c0\.pjoining\.ece_websocket_error_[a-z0-9_]*$/);
    expect(c).not.toMatch(/[?&=:/ ]/);
  });
});
