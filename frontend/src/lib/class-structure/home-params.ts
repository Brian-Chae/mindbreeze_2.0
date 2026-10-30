import type { ListParams } from '../api/class-structure';

/** 홈은 진행·예정 클래스만 받는다(다음 일정·열린 회차의 근거). 전체·과거는 목록 화면이 따로 받는다. */
export const HOME_ACTIVE_CLASS_PARAMS: ListParams = { status: 'active' };
