//! Runs the C++ host scenarios in `cpp/scenarios.cc`.
//!
//! The scenarios link the real `ModalInputRouter` (the same `.cc` file the
//! Chromium build uses) against the real `modal_browser_ffi` bridge, with an
//! in-memory `FakeBrowser` standing in for Chromium.

// Linked for its `extern "Rust"` symbols, which the C++ calls.
use modal_browser_ffi as _;

#[cxx::bridge(namespace = "modal_browser::harness")]
mod ffi {
    unsafe extern "C++" {
        include!("cpp/scenarios.h");

        /// Runs every scenario; returns the number of failed checks and
        /// prints each failure to stderr.
        fn RunAllScenarios() -> i32;
    }
}

pub fn run_all_scenarios() -> i32 {
    ffi::RunAllScenarios()
}
