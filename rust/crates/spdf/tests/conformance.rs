//! The whole conformance suite (`conformance/cases/*.json`) as a test.

use std::path::PathBuf;

#[test]
fn conformance_suite() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../conformance");
    if !dir.join("cases").exists() {
        panic!("conformance suite not found at {}", dir.display());
    }
    let report = spdf::conformance::run_dir(&dir, None).expect("runner");
    if !report.failed.is_empty() {
        let lines: Vec<String> = report
            .failed
            .iter()
            .map(|f| format!("  {}: {}", f.id, f.reason))
            .collect();
        panic!(
            "{} of {} conformance cases failed:\n{}",
            report.failed.len(),
            report.failed.len() + report.passed.len(),
            lines.join("\n")
        );
    }
    assert!(
        report.passed.len() >= 220,
        "only {} cases found",
        report.passed.len()
    );
    let manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(dir.join("manifest.json")).expect("manifest"))
            .expect("json");
    assert_eq!(
        report.passed.len() as u64,
        manifest["cases"].as_u64().unwrap_or(0),
        "every case of the manifest must run"
    );
}
