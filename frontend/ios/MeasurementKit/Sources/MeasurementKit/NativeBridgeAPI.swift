import Foundation

/// 브리지 확장 메서드의 요청 해석·결과 생성(플러그인은 이 함수만 거쳐 응답한다 — 계약 시험 대상).
public enum NativeBridgeAPI {
    public struct RegisterCredentialRequest {
        public let accountId: String, accessToken: String, refreshToken: String, apiBase: String
    }

    /// 계약 RegisterCredentialRequest: accountId(1~128)·accessToken·refreshToken·apiBase(1~512) 필수, 그 밖의 키는 무시(callbackId 등 Capacitor 내부 키).
    public static func parseRegisterCredential(_ o: [String: Any]) -> RegisterCredentialRequest? {
        guard let acct = o["accountId"] as? String, (1...128).contains(acct.count),
              let at = o["accessToken"] as? String, !at.isEmpty,
              let rt = o["refreshToken"] as? String, !rt.isEmpty,
              let base = o["apiBase"] as? String, (1...512).contains(base.count) else { return nil }
        return RegisterCredentialRequest(accountId: acct, accessToken: at, refreshToken: rt, apiBase: base)
    }

    /// 결과는 불투명 핸들 하나뿐. 토큰·계정 정보를 되돌리지 않는다.
    public static func registerCredentialResult(handle: String) -> [String: Any] { ["credentialHandle": handle] }
}
