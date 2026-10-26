import Foundation
import CryptoKit

/// 활성 표준 모델(sigmoid) 1회 pin. Android ModelPin.kt 와 같은 의미 — 웹 `scoreIndices` 규칙(활성 모델 > 코호트)을 앱에도 적용한다.
/// 수업 시작에 한 번 고정하고(파일 `model-pin.json`) 도중 교체하지 않는다. 프로세스 재생성 복구도 같은 파일을 읽는다.
/// 모델이 없으면 nil → 기존 legacy_cohort 설정 그대로.
public struct ModelPin: Equatable {
    public let paramsJSON: String, modelVersion: String, modelHash: String

    static let metrics: Set<String> = ["focusIndex", "relaxationIndex", "stressIndex", "totalNeuralActivity", "faa", "cognitiveLoad",
                                       "emotionalStability", "autonomicStability", "sdnn", "avgHeartRate", "breathingStability"]

    public static let defaultConfig = """
    {"abi_version":1,"device_profile_version":"linkband2-v1","algorithm_version":"web-ts-1","model_version":"b0-cohort-2","model_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","model_mode":"legacy_cohort","rates_hz":{"eeg":250,"ppg":50,"acc":30},"anchor":"last_sample_web_v1","acc_interval_profile":"rounded_33333us_v1"}
    """

    /// 검증·정규화(키 정렬, direction 정수화). 유효 지표가 하나도 없으면 nil.
    public static func build(rawParams: String?, version: String?) -> ModelPin? {
        guard let raw = rawParams, !raw.trimmingCharacters(in: .whitespaces).isEmpty,
              let src = (try? JSONSerialization.jsonObject(with: Data(raw.utf8))) as? [String: Any] else { return nil }
        var parts: [String] = []
        for k in src.keys.sorted() where metrics.contains(k) {
            guard let o = src[k] as? [String: Any], let m = num(o["m"]), let s = num(o["s"]), let dir = direction(o["direction"]) else { continue }
            if !m.isFinite || !s.isFinite || s <= 0 || (dir != 1 && dir != -1) { continue }
            parts.append("\"\(k)\":{\"m\":\(fmt(m)),\"s\":\(fmt(s)),\"direction\":\(dir)}")
        }
        if parts.isEmpty { return nil }
        let params = "{" + parts.joined(separator: ",") + "}"
        return ModelPin(paramsJSON: params, modelVersion: versionOf(version), modelHash: sha256(params))
    }

    private static func num(_ v: Any?) -> Double? {
        guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        return n.doubleValue
    }
    private static func direction(_ v: Any?) -> Int? {
        if let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() { return n.intValue }
        if let s = v as? String { return Int(s) }
        return nil
    }
    private static func fmt(_ d: Double) -> String { "\(d)" }

    /// 서버 `_VERSION_RE`(^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$) 를 항상 통과하는 model_version.
    static func versionOf(_ v: String?) -> String {
        let allowed = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._+-")
        let clean = String((v ?? "").filter { allowed.contains($0) })
        var s = "sigmoid-" + (clean.isEmpty ? "0" : clean)
        s = String(s.prefix(64))
        while s.hasSuffix("-") { s.removeLast() }
        return s
    }

    private static func sha256(_ s: String) -> String { SHA256.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined() }

    /// 코어 설정: pin 이 있으면 active_sigmoid + 모델 버전·해시, 없으면 기존 기본값(legacy_cohort).
    public static func configJSON(_ pin: ModelPin?) -> String {
        guard let pin = pin, var o = (try? JSONSerialization.jsonObject(with: Data(defaultConfig.utf8))) as? [String: Any] else { return defaultConfig }
        o["model_mode"] = "active_sigmoid"; o["model_version"] = pin.modelVersion; o["model_hash"] = pin.modelHash
        guard let d = try? JSONSerialization.data(withJSONObject: o, options: [.sortedKeys]), let s = String(data: d, encoding: .utf8) else { return defaultConfig }
        return s
    }

    /// pin 파일이 있으면 그것을(교체 금지), 없고 입력 모델이 유효하면 새로 기록한다. 손상 파일은 새로 쓴다.
    public static func loadOrCreate(file: URL, rawParams: String?, version: String?) -> ModelPin? {
        if let p = read(file) { return p }
        guard let pin = build(rawParams: rawParams, version: version) else { return nil }
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        let body: [String: Any] = ["params": (try? JSONSerialization.jsonObject(with: Data(pin.paramsJSON.utf8))) ?? [:], "version": pin.modelVersion, "hash": pin.modelHash]
        if let d = try? JSONSerialization.data(withJSONObject: body) { try? d.write(to: file, options: .atomic) }
        return pin
    }

    private static func read(_ file: URL) -> ModelPin? {
        guard let d = try? Data(contentsOf: file), let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
              let params = o["params"], let pd = try? JSONSerialization.data(withJSONObject: params), let ps = String(data: pd, encoding: .utf8),
              let ver = o["version"] as? String, let hash = o["hash"] as? String,
              let rebuilt = build(rawParams: ps, version: nil), rebuilt.modelHash == hash else { return nil }
        return ModelPin(paramsJSON: rebuilt.paramsJSON, modelVersion: ver, modelHash: hash)
    }
}
