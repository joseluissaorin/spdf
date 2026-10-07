// swift-tools-version:5.9
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
        // Thin C shim: SQLite calls Swift cannot make (variadic sqlite3_db_config)
        // and gzip through zlib. Links the system SQLite and zlib.
        .target(
            name: "CSPDF",
            linkerSettings: [.linkedLibrary("sqlite3"), .linkedLibrary("z")]
        ),
        .target(
            name: "SPDF",
            dependencies: [
                "CSPDF",
                .product(name: "Crypto", package: "swift-crypto", condition: .when(platforms: [.linux])),
            ],
            swiftSettings: [.enableExperimentalFeature("StrictConcurrency")]
        ),
        .target(name: "SPDFConformance", dependencies: ["SPDF"]),
        .executableTarget(name: "spdf-cli", dependencies: ["SPDF", "SPDFConformance"]),
        .testTarget(name: "SPDFTests", dependencies: ["SPDF", "SPDFConformance"]),
    ]
)
