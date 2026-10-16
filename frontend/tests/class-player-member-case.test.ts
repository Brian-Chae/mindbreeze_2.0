// SDD-208 M1 — 회원 케이스 파생(deriveMemberCase): 시안 member.html 의 CASES 표(M01~M21)와 같은 키·문구를 내는지
import { describe, expect, it } from 'vitest';
import {
  MEMBER_CASE_DEFAULT,
  deriveMemberCase,
  memberInput,
  type MemberCaseInput,
} from '../src/lib/class/member-player-case';

/** 시안 member.html CASES — 기본값과 다른 키만 적는다 */
const CASES: Record<string, Partial<MemberCaseInput>> = {
  M01: {},
  M02: { mode: 'group', mic: 'muted' },
  M03: { mode: 'group', mic: 'muted', hand: 'waiting' },
  M04: { mode: 'group', mic: 'on', hand: 'speaking' },
  M05: { place: 'offline', mic: 'none', cam: 'none' },
  M06: { place: 'offline', mic: 'none', cam: 'none', band: 'off' },
  M07: { band: 'off' },
  M08: { band: 'pending' },
  M09: { band: 'weak' },
  M10: { band: 'leadoff' },
  M11: { band: 'lost' },
  M12: { band: 'low', battery: 15 },
  M13: { band: 'unsupported' },
  M14: { mic: 'off' },
  M15: { mic: 'denied' },
  M16: { cam: 'off' },
  M17: { cam: 'denied' },
  M18: { net: 'reconnecting' },
  M19: { net: 'down' },
  M20: { view: 'waitlist' },
  M21: { view: 'end' },
};
const derive = (id: string) => deriveMemberCase(memberInput(CASES[id]));

describe('memberInput 기본값(공통 입력)', () => {
  it('온라인·1:1·카메라 on·마이크 on·손들기 idle·밴드 on·네트워크 ok·live', () => {
    expect(MEMBER_CASE_DEFAULT).toMatchObject({
      view: 'live', place: 'online', mode: '1on1', cam: 'on', mic: 'on', hand: 'idle', band: 'on', net: 'ok', hostCamera: true, bandEnabled: true,
    });
  });
});

describe('M01 기본형', () => {
  const c = derive('M01');
  it('상담사 PiP·내 PiP·미디어 줄(마이크·카메라)이 모두 있다', () => {
    expect(c.showHostPip).toBe(true);
    expect(c.showMyPip).toBe(true);
    expect(c.showMediaRow).toBe(true);
    expect(c.mic).toMatchObject({ s: 'on', label: '마이크 켜짐', disabled: false });
    expect(c.cam).toMatchObject({ s: 'on', label: '카메라 켜짐', disabled: false });
    expect(c.hand).toBeNull();
  });
  it('안내 칩 없음, 링은 지표 게이지(live)', () => {
    expect(c.notice).toBeNull();
    expect(c.ring).toMatchObject({ core: 'gauge', tone: 'live', showValue: true });
  });
  it('도크 5개(내 상태·채팅·조용한 신호·소리·기기)', () => {
    expect(c.dock.map((d) => d.key)).toEqual(['status', 'chat', 'signal', 'sound', 'device']);
    expect(c.dock.map((d) => d.label)).toEqual(['내 상태', '채팅', '조용한 신호', '소리', '기기']);
  });
  it('슬롯 카드 없음 → 5분 추이를 보여 준다', () => {
    expect(c.slot).toBeNull();
    expect(c.showTrend).toBe(true);
  });
});

describe('M02~M04 온라인 그룹(기본 뮤트·손들기·발언권)', () => {
  it('M02: 기본 뮤트 — 마이크 "뮤트 중"(비활성) · 손들기 활성 · 카메라 버튼/내 PiP 없음', () => {
    const c = derive('M02');
    expect(c.notice).toEqual({ tone: 'info', icon: 'micOff', text: '이 수업은 기본 뮤트예요 · 말하고 싶을 땐 손들기를 눌러 주세요' });
    expect(c.mic).toMatchObject({ s: 'muted', label: '뮤트 중', disabled: true });
    expect(c.hand).toMatchObject({ s: 'idle', label: '손들기', disabled: false });
    expect(c.cam).toBeNull();
    expect(c.showMyPip).toBe(false);
    expect(c.showHostPip).toBe(true);
  });
  it('M03: 손들기 대기 — 문구 "손들었어요", 취소 버튼은 두지 않는다(B1 미적용: 비활성 상태 표시)', () => {
    const c = derive('M03');
    expect(c.notice).toEqual({ tone: 'info', icon: 'hand', text: '손들었어요 · 상담사가 확인 중이에요' });
    expect(c.hand).toMatchObject({ s: 'waiting', label: '손들었어요', disabled: true });
    expect(JSON.stringify(c)).not.toContain('취소');
  });
  it('M04: 발언권 부여 — 마이크 "말하는 중"(상태 표시) · "말하기 종료" 버튼', () => {
    const c = derive('M04');
    expect(c.notice).toEqual({ tone: 'live', icon: 'mic', text: '말하는 중이에요 · 끝나면 말하기 종료를 눌러 주세요' });
    expect(c.mic).toMatchObject({ s: 'speaking', label: '말하는 중', disabled: true });
    expect(c.hand).toMatchObject({ s: 'speaking', label: '말하기 종료', disabled: false });
    expect(c.cam).toBeNull();
  });
  it('그룹에서 마이크 권한이 막혀 있으면 마이크 "마이크 막힘"', () => {
    const c = deriveMemberCase(memberInput({ mode: 'group', mic: 'denied', hand: 'speaking' }));
    expect(c.mic).toMatchObject({ s: 'denied', label: '마이크 막힘', disabled: true });
  });
});

describe('M05·M06 오프라인(대면) — 영상·마이크·카메라 UI 자체가 없다(D2)', () => {
  it.each(['M05', 'M06'])('%s: PiP 둘·미디어 줄 없음, 도크에 조용한 신호 없음', (id) => {
    const c = derive(id);
    expect(c.showHostPip).toBe(false);
    expect(c.showMyPip).toBe(false);
    expect(c.showMediaRow).toBe(false);
    expect(c.mic).toBeNull();
    expect(c.cam).toBeNull();
    expect(c.hand).toBeNull();
    expect(c.showSideCard).toBe(true);
    expect(c.dock.map((d) => d.key)).toEqual(['status', 'chat', 'sound', 'device']);
  });
  it('M05: 밴드 연결 — 게이지 링 + 안내 없음', () => {
    const c = derive('M05');
    expect(c.ring.core).toBe('gauge');
    expect(c.notice).toBeNull();
    expect(c.showTrend).toBe(true);
  });
  it('M06: 무밴드 — 링 자리 안내 + 밴드 연결 슬롯 카드, 코랄 톤 없음', () => {
    const c = derive('M06');
    expect(c.ring).toMatchObject({ core: 'msg', tone: 'idle', title: '밴드 없이\n참여 중이에요', subtitle: '측정 없이도 수업은\n그대로 진행돼요' });
    expect(c.notice).toEqual({ tone: 'info', icon: 'info', text: '밴드를 연결하면 내 상태가 이 링에 나타나요' });
    expect(c.slot).toMatchObject({ tone: 'default', icon: 'bluetooth', text: '원하시면 기기에서 LINK BAND를 연결할 수 있어요.', action: { label: '밴드 연결', act: 'openDevice' } });
    expect(c.showTrend).toBe(false);
  });
});

describe('M07~M13 밴드 8상태', () => {
  it('M07 미착용: 링 안내 · 슬롯 카드 [밴드 연결] · 경고색 아님', () => {
    const c = derive('M07');
    expect(c.ring).toMatchObject({ core: 'msg', tone: 'idle', title: '밴드 없이\n참여 중이에요' });
    expect(c.slot).toMatchObject({ tone: 'default', action: { label: '밴드 연결', act: 'openDevice' } });
    expect(c.notice?.tone).toBe('info');
  });
  it('M08 연결 대기: 3점 순차 페이드 · [취소]', () => {
    const c = derive('M08');
    expect(c.ring).toMatchObject({ core: 'msg', tone: 'idle', dots: true, title: '밴드를 연결하는\n중이에요' });
    expect(c.notice).toEqual({ tone: 'info', icon: 'bluetooth', text: '연결되면 이 링에 내 상태가 나타나요' });
    expect(c.slot).toMatchObject({ text: '오래 걸리면 밴드 전원이 켜져 있는지 확인해 주세요.', action: { label: '취소', act: 'cancel' } });
  });
  it('M09 신호 약함: 링 값 유지 + 주의색 밀착 안내 칩', () => {
    const c = derive('M09');
    expect(c.ring.core).toBe('gauge');
    expect(c.notice).toEqual({ tone: 'caution', icon: 'signalLow', text: '접촉이 약해요 · 밴드를 이마에 살짝 밀착해 주세요' });
    expect(c.slot).toBeNull();
  });
  it('M10 리드오프: 링 회색 안내 + 코랄 칩 + [확인 방법] → 기기 시트', () => {
    const c = derive('M10');
    expect(c.ring).toMatchObject({ core: 'msg', tone: 'idle', icon: 'alert', title: '접촉을 확인해\n주세요' });
    expect(c.notice).toEqual({ tone: 'coral', icon: 'alert', text: '접촉이 확인되면 다시 측정해요' });
    expect(c.slot).toMatchObject({ tone: 'coral', text: '밴드가 피부에 닿지 않았어요. 확인 방법을 볼 수 있어요.', action: { label: '확인 방법', act: 'openDevice' } });
  });
  it('M11 끊김: 마지막 값 흐림 + "다시 연결하는 중" + 코랄 칩 + [다시 연결]', () => {
    const c = derive('M11');
    expect(c.ring).toMatchObject({ core: 'dim', tone: 'idle', subtitle: '다시 연결하는\n중이에요', showValue: true });
    expect(c.notice).toEqual({ tone: 'coral', icon: 'wifiOff', text: '밴드 연결이 끊겼어요 · 자동으로 다시 연결하고 있어요' });
    expect(c.slot).toMatchObject({ tone: 'coral', text: '다시 연결해도 앞서 측정한 값은 안전하게 보관돼요.', action: { label: '다시 연결', act: 'retry' } });
  });
  it('M12 배터리 부족: 링 유지 + 실제 배터리 % 를 문구에 넣는다', () => {
    const c = derive('M12');
    expect(c.ring.core).toBe('gauge');
    expect(c.notice).toEqual({ tone: 'caution', icon: 'battery', text: '배터리가 15%예요 · 곧 충전해 주세요' });
    const other = deriveMemberCase(memberInput({ band: 'low', battery: 22.4 }));
    expect(other.notice?.text).toBe('배터리가 22%예요 · 곧 충전해 주세요');
    const unknown = deriveMemberCase(memberInput({ band: 'low', battery: null }));
    expect(unknown.notice?.text).toBe('배터리가 부족해요 · 곧 충전해 주세요');
  });
  it('M13 미지원 브라우저: 정보 톤 + [밴드 없이 계속]', () => {
    const c = derive('M13');
    expect(c.ring).toMatchObject({ core: 'msg', tone: 'idle', title: '밴드 없이\n참여 중이에요' });
    expect(c.notice).toEqual({ tone: 'info', icon: 'info', text: '이 브라우저에서는 밴드 연결이 안 돼요' });
    expect(c.slot).toMatchObject({ tone: 'default', text: 'Chrome 또는 Edge로 열면 밴드를 연결할 수 있어요.', action: { label: '밴드 없이 계속', act: 'continue' } });
  });
});

describe('M14~M17 마이크·카메라 상태(온라인 1:1)', () => {
  it('M14 마이크 꺼짐(D4): 회원 음성이 상담사에게 전달되지 않음 + 뇌파는 계속 기록', () => {
    const c = derive('M14');
    expect(c.mic).toMatchObject({ s: 'off', label: '마이크 꺼짐', disabled: false });
    expect(c.notice).toEqual({
      tone: 'caution', icon: 'micOff',
      text: '마이크 꺼짐 · 상담사에게 내 목소리가 전달되지 않아요(뇌파는 계속 기록돼요)',
    });
    expect(c.notice?.text).not.toContain('AI 기록');
    expect(c.ring.core).toBe('gauge');
  });
  it('M15 마이크 권한 거부: 코랄 칩 + 허용 방법 3줄 슬롯', () => {
    const c = derive('M15');
    expect(c.mic).toMatchObject({ s: 'denied', label: '마이크 막힘', disabled: true });
    expect(c.notice).toEqual({ tone: 'coral', icon: 'micOff', text: '마이크 권한이 꺼져 있어요 · 아래 방법으로 허용해 주세요' });
    expect(c.slot).toMatchObject({
      tone: 'coral', title: '마이크 허용 방법',
      steps: ['주소창의 자물쇠 아이콘을 눌러요', '마이크를 “허용”으로 바꿔요', '페이지를 새로 고쳐요'],
    });
  });
  it('M16 내 카메라 꺼짐: 카메라 "카메라 꺼짐" · 내 PiP 자리는 유지', () => {
    const c = derive('M16');
    expect(c.cam).toMatchObject({ s: 'off', label: '카메라 꺼짐', disabled: false });
    expect(c.showMyPip).toBe(true);
    expect(c.myCam).toBe('off');
    expect(c.notice).toBeNull();
  });
  it('M17 카메라 권한 거부/기기 없음: "카메라 막힘" + 수업은 계속된다는 코랄 칩', () => {
    for (const cam of ['denied', 'nodevice'] as const) {
      const c = deriveMemberCase(memberInput({ cam }));
      expect(c.cam).toMatchObject({ s: 'denied', label: '카메라 막힘', disabled: true });
      expect(c.myCam).toBe(cam);
      expect(c.notice).toEqual({ tone: 'coral', icon: 'cameraOff', text: '수업은 그대로 계속돼요 · 설정에서 카메라를 허용해 주세요' });
    }
  });
  it('마이크 꺼짐이 카메라 거부보다 우선하는 안내 순서를 따른다(시안 notice 순서)', () => {
    const c = deriveMemberCase(memberInput({ mic: 'off', cam: 'denied' }));
    expect(c.notice?.icon).toBe('micOff');
    expect(c.notice?.tone).toBe('caution');
  });
});

describe('M18~M21 네트워크·전체 화면', () => {
  it('M18 재연결 중: 코랄 배너 + 연결 점 "재연결 중" + PiP 정지 표시', () => {
    const c = derive('M18');
    expect(c.banner).toEqual({ title: '연결이 불안정해요', text: '· 다시 연결 중이에요' });
    expect(c.conn).toMatchObject({ ok: false, label: '재연결 중' });
    expect(c.pipFrozen).toBe(true);
    expect(c.netDown).toBe(false);
  });
  it('M19 끊김: 전체 안내 카드(링·슬롯·미디어 줄 숨김) + 연결 끊김 표시', () => {
    const c = derive('M19');
    expect(c.netDown).toBe(true);
    expect(c.conn).toMatchObject({ ok: false, label: '연결 끊김' });
    expect(c.showMediaRow).toBe(false);
  });
  it('정상 네트워크: 배너 없음·연결됨·PiP 정지 아님', () => {
    const c = derive('M01');
    expect(c.banner).toBeNull();
    expect(c.conn).toMatchObject({ ok: true, label: '연결됨' });
    expect(c.pipFrozen).toBe(false);
  });
  it('M20 대기열 / M21 종료는 view 만 바뀐다', () => {
    expect(derive('M20').view).toBe('waitlist');
    expect(derive('M21').view).toBe('end');
    expect(derive('M01').view).toBe('live');
  });
});

describe('상담사 영상·linkband_mode=none', () => {
  it('상담사 카메라 트랙이 없으면(온라인) 상담사 PiP 를 그리지 않는다', () => {
    expect(deriveMemberCase(memberInput({ hostCamera: false })).showHostPip).toBe(false);
  });
  it('D7: 밴드를 쓰지 않는 수업은 기기·내 상태 도크와 밴드 안내(칩·슬롯)가 없고 링 자리는 수업 안내로 대체', () => {
    const c = deriveMemberCase(memberInput({ bandEnabled: false, band: 'off' }));
    expect(c.dock.map((d) => d.key)).toEqual(['chat', 'signal', 'sound']);
    expect(c.slot).toBeNull();
    expect(c.notice).toBeNull();
    expect(c.ring).toMatchObject({ core: 'msg', tone: 'idle', title: '함께하는\n수업이에요', subtitle: '이 수업은 밴드 없이\n진행돼요' });
    expect(c.showTrend).toBe(false);
  });
});

describe('P5·P6 금지 문구 — 파생 결과 전체에 호흡 지시·그룹 비교 문구가 없다', () => {
  const FORBIDDEN_BREATH = /호흡에 집중|숨을 (들이|내쉬)|들이쉬|내쉬|호흡하세요|천천히 호흡|심호흡/;
  const FORBIDDEN_COMPARE = /그룹|평균|순위|상위|하위|종합|총점|점수/;
  it.each(Object.keys(CASES))('%s', (id) => {
    const text = JSON.stringify(derive(id));
    expect(text).not.toMatch(FORBIDDEN_BREATH);
    expect(text).not.toMatch(FORBIDDEN_COMPARE);
  });
});
