#[test]
fn cpp_host_scenarios_pass() {
    assert_eq!(
        host_harness::run_all_scenarios(),
        0,
        "see stderr for failed checks"
    );
}
