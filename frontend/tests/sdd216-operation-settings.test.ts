import { expect, it } from 'vitest';
import { settingsSchedule } from '../src/lib/class-structure/operation-settings';
import type { ClassDetailDto } from '../src/lib/api/class-structure';
const detail={title:'명상',location_type:'online',location_address:null,capacity:12,linkband_mode:'optional',record_audio:false,record_video:true,chat_enabled:true,schedule_mode:'fixed',planned_session_count:8,default_duration_min:60,reminder_offsets:[60],ends_on:null,recurrence_rule:{version:1,start_date:'2026-11-01',weekdays:[1],time:'19:00',interval_weeks:1,skip_dates:[]},assignment_rule:{version:1,mode:'all_one',host_ids:['h'],weekday_hosts:{}},host_view:{instructors:[{user_id:'h',role:'lead',status:'active'}]}} as ClassDetailDto;
it('설정 저장은 조회값을 보존하고 이미 생성된 회차를 다시 만들지 않는다',()=>{const input=settingsSchedule(detail);expect(input).toMatchObject({record_audio:false,record_video:true,chat_enabled:true,reminder_offsets:[60],rows:[],member_ids:[]});});
it('조회 설정이 없으면 기본값으로 덮어쓰지 않고 저장을 차단한다',()=>{expect(()=>settingsSchedule({...detail,chat_enabled:undefined})).toThrow('현재 설정');});
