import AVFoundation

/// 수업 음성 녹음·송출용 오디오 세션 설정 (백그라운드 녹음 보장).
/// WKWebView 의 getUserMedia/MediaRecorder 가 앱이 백그라운드에서도 마이크를 유지하려면
/// UIBackgroundModes=audio + 입력 가능한 카테고리(playAndRecord) + 활성 세션이 필요하다.
enum AudioSessionConfig {
    static let category: AVAudioSession.Category = .playAndRecord
    static let mode: AVAudioSession.Mode = .default
    // allowBluetoothA2DP: 블루투스 헤드폰 출력은 고음질 유지. defaultToSpeaker: 수업 음원을 스피커로.
    // mixWithOthers 는 쓰지 않는다(다른 앱 오디오에 밀려 세션이 끊기는 것을 피함).
    static let options: AVAudioSession.CategoryOptions = [.allowBluetoothA2DP, .defaultToSpeaker]

    /// 카테고리 설정 후 활성화. 실패해도 앱 시작을 막지 않도록 에러를 던진다(호출부가 로그).
    static func apply(to session: AVAudioSession = .sharedInstance()) throws {
        try session.setCategory(category, mode: mode, options: options)
        try session.setActive(true)
    }
}
