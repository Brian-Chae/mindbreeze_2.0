/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** SDD-246: 'true' 일 때만 session-live v2(LiveClient) 사용 */
  readonly VITE_LIVE_PROTOCOL_V2?: string;
  /** SDD-286: 'true' 일 때만 로그인 화면에 비회원 코드 입장 버튼 표시 */
  readonly VITE_GUEST_ENTRY_ENABLED?: string;
}
