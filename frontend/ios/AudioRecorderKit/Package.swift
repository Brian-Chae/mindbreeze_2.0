// swift-tools-version: 5.9
import PackageDescription

// SDD-247 iOS — 수업 녹음 순수 로직(분할기·인코더·큐·토큰·업로더·상태기계). FFI 의존 없음 → swift test 가능.
let package = Package(
    name: "AudioRecorderKit",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [.library(name: "AudioRecorderKit", targets: ["AudioRecorderKit"])],
    targets: [
        .target(name: "AudioRecorderKit"),
        .testTarget(name: "AudioRecorderKitTests", dependencies: ["AudioRecorderKit"]),
    ]
)
