fn main() {
    let overlay = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../overlay");
    let router = overlay.join("chrome/browser/ui/modal_browser/modal_input_router.cc");

    cxx_build::bridge("src/lib.rs")
        .std("c++20")
        // Resolve "chrome/browser/ui/modal_browser/..." like Chromium's //.
        .include(&overlay)
        .include(env!("CARGO_MANIFEST_DIR"))
        .file(&router)
        .file("cpp/fake_browser.cc")
        .file("cpp/scenarios.cc")
        .flag_if_supported("-Wall")
        .flag_if_supported("-Wextra")
        .flag_if_supported("-Werror")
        .flag_if_supported("-Wno-unused-parameter")
        .compile("host_harness_cpp");

    for path in [
        "src/lib.rs",
        "cpp/fake_browser.h",
        "cpp/fake_browser.cc",
        "cpp/scenarios.h",
        "cpp/scenarios.cc",
    ] {
        println!("cargo:rerun-if-changed={path}");
    }
    println!("cargo:rerun-if-changed={}", router.display());
    println!(
        "cargo:rerun-if-changed={}",
        overlay
            .join("chrome/browser/ui/modal_browser/modal_input_router.h")
            .display()
    );
}
