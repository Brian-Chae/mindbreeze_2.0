// swift-tools-version: 5.9
import PackageDescription

// SDD-246 T07 — iOS 측정 런타임. Rust 코어(C ABI)는 scripts/build-core-xcframework.sh 가 만든 xcframework 로 링크한다.
let package = Package(
    name: "MeasurementKit",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [.library(name: "MeasurementKit", targets: ["MeasurementKit"])],
    targets: [
        .binaryTarget(name: "MeasurementCoreFFI", path: "Frameworks/MeasurementCoreFFI.xcframework"),
        .target(
            name: "MeasurementKit",
            dependencies: ["MeasurementCoreFFI"],
            linkerSettings: [.linkedLibrary("sqlite3")]
        ),
        .testTarget(name: "MeasurementKitTests", dependencies: ["MeasurementKit"]),
    ]
)
