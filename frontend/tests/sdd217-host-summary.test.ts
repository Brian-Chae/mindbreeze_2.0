import { expect,it } from 'vitest';
import { buildHostCaseInput } from '../src/lib/class/fixtures/host-cases';
import { deriveHostCase,summarizeCheckins,type HostParticipant } from '../src/lib/class/host-player-case';
const input=()=>buildHostCaseInput('C13').input;
const people=():HostParticipant[]=>[
 {...input().participants[0],id:'entered',band:'off',checkin:[],checkinState:'completed',presenceState:'connected'},
 {...input().participants[1],id:'invited',band:'off',checkin:[['이전 대기실 값','원문으로 완료 추정 금지']],checkinState:'unknown',presenceState:'unknown',enteredAt:null},
];
it('T11 호스트 접속 인원은 미착용 수와 분리해 서버 connected만 센다',()=>{
 const result=deriveHostCase({...input(),participants:people()});
 expect(result.stats).toEqual({joined:1,total:2});
 const checkin=result.chips.find(c=>c.key==='checkin');expect(checkin?.label).toBe('체크인 1/2');
 const band=result.chips.find(c=>c.key==='band');expect(band?.key==='band'&&band.off).toBe(2);
});
it('T11 체크인 시트는 원문 없이도 저장된 completed를 세고 unknown 원문은 완료로 추정하지 않는다',()=>{
 const result=summarizeCheckins(people());expect(result.responded).toBe(1);expect(result.total).toBe(2);expect(result.questions).toHaveLength(0);
});
it('T11 오프라인 요약은 접속 종료 후에도 저장된 체크인 완료를 보존한다',()=>{
 const result=deriveHostCase({...input(),loc:'offline',participants:people().map(p=>({...p,presenceState:'disconnected'}))});
 expect(result.stats.joined).toBe(0);expect(result.summary).toMatchObject({checkinDone:1,checkinTotal:2});
});
it('T11 서버 접속 근거 없는 기존 밴드 연결 행도 접속 인원으로 추정하지 않는다',()=>{
 const result=deriveHostCase({...input(),participants:people().map(p=>({...p,band:'on',presenceState:undefined}))});
 expect(result.stats).toEqual({joined:0,total:2});
});
