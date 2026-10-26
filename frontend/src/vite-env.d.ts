/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** SDD-246: 'true' 일 때만 session-live v2(LiveClient) 사용 */
  readonly VITE_LIVE_PROTOCOL_V2?: string;
}
