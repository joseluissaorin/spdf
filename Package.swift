// swift-tools-version:5.9
// SwiftPM manifest at the repository root so that
// `.package(url: "https://github.com/joseluissaorin/spdf", from: "0.1.0")` works.
// The sources live in swift/ (see swift/README.md); keep this file in sync with
// swift/Package.swift.
import PackageDescription

let package = Package(
    name: "SPDF",
    platforms: [.iOS(.v16), .macOS(.v13), .tvOS(.v16), .watchOS(.v9), .visionOS(.v1)],
    products: [
        .library(name: "SPDF", targets: ["SPDF"]),
        .library(name: "SPDFConformance", targets: ["SPDFConformance"]),
        .executable(name: "spdf-swift", targets: ["spdf-cli"]),
    ],
    dependencies: [
        // Only used on Linux, where CryptoKit does not exist (same API).
        .package(url: "https://github.com/apple/swift-crypto.git", "3.0.0"..<"5.0.0"),
    ],
    targets: [
        .target(
            name: "CSPDF",
            path: "swift/Sources/CSPDF",
            linkerSettings: [.linkedLibrary("sqlite3"), .linkedLibrary("z")]
        ),
        .target(
            name: "SPDF",
            dependencies: [
                "CSPDF",
                .product(name: "Crypto", package: "swift-crypto", condition: .when(platforms: [.linux])),
            ],
            path: "swift/Sources/SPDF",
            swiftSettings: [.enableExperimentalFeature("StrictConcurrency")]
        ),
        .target(name: "SPDFConformance", dependencies: ["SPDF"], path: "swift/Sources/SPDFConformance"),
        .executableTarget(name: "spdf-cli", dependencies: ["SPDF", "SPDFConformance"], path: "swift/Sources/spdf-cli"),
        .testTarget(name: "SPDFTests", dependencies: ["SPDF", "SPDFConformance"], path: "swift/Tests/SPDFTests"),
    ]
)
