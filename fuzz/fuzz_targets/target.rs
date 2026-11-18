#![no_main]

use libfuzzer_sys::fuzz_target;

#[allow(dead_code)]
#[path = "../../overlay/components/modal_browser/core/tests/roundtrip/mod.rs"]
mod roundtrip;

fuzz_target!(|data: &[u8]| {
    if let Ok(text) = std::str::from_utf8(data) {
        roundtrip::target(text);
    }
});
