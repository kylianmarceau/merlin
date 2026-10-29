//! Validates a configuration file without starting the browser:
//! `cargo run -p modal_browser_core --example check_config -- path/to/config.toml`

use modal_browser_core::ModalSession;

fn main() {
    let Some(path) = std::env::args().nth(1) else {
        eprintln!("usage: check_config <config.toml>");
        std::process::exit(2);
    };
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) => {
            eprintln!("{path}: {e}");
            std::process::exit(2);
        }
    };
    let report = ModalSession::new().load_config(&text);
    for e in &report.errors {
        eprintln!("{path}: {e}");
    }
    println!(
        "{path}: {} bindings, {} errors",
        report.bindings,
        report.errors.len()
    );
    std::process::exit(i32::from(!report.errors.is_empty()));
}
