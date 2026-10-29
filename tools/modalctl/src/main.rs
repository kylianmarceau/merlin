//! Drive a `ModalSession` from the terminal and see the actions it emits.
//!
//! ```text
//! keys gg            press keys (Vim notation: j, gg, <C-d>, <Esc>, <S-Esc>)
//! keys! jk           press keys while a text field has focus
//! :tabnew docs.rs    submit a command line
//! focus editable     report a focus change (page | editable | rich | ui)
//! timeout            fire the sequence timer
//! complete tab       show completions
//! hints 20           answer a hint request with 20 links
//! palette doc        type into the open palette; `palette!` presses Enter
//! page mail.google.com   report a page change (site passthrough)
//! config file.toml   load a configuration file
//! quit
//! ```

use std::io::{self, BufRead, Write};

use modal_browser_core::{
    Action, Editable, FocusContext, FocusTarget, HintKind, KeySequence, ModalSession, Outcome,
    PaletteKey,
};

fn print_outcome(label: &str, o: &Outcome) {
    let mut line = format!(
        "{label:<10} {:?} mode={}",
        o.disposition,
        o.mode.indicator()
    );
    if !o.pending.is_empty() {
        line.push_str(&format!(" pending={}", o.pending));
    }
    if let Some(ms) = o.timeout_ms {
        line.push_str(&format!(" timeout={ms}ms"));
    }
    println!("{line}");
    for action in &o.actions {
        println!("           -> {action:?}");
    }
    for hint in &o.which_key {
        println!("           ?  {:<6} {}", hint.keys, hint.desc);
    }
    if let Some(error) = &o.error {
        println!("           !! {error}");
    }
}

fn focus_from(word: &str) -> Option<FocusContext> {
    let target = match word {
        "page" => FocusTarget::Page,
        "editable" => FocusTarget::PageEditable(Editable::PlainText),
        "rich" => FocusTarget::PageEditable(Editable::RichText),
        "ui" => FocusTarget::BrowserUi,
        _ => return None,
    };
    Some(FocusContext {
        target,
        ime_composing: false,
    })
}

fn print_palette(session: &ModalSession) {
    let Some(p) = session.palette() else {
        return;
    };
    println!("  [{}] {}", p.kind.prompt(), p.text);
    if let Some(error) = &p.error {
        println!("  !! {error}");
    }
    for (i, row) in p.rows.iter().take(10).enumerate() {
        let marker = if p.selected == Some(i) { ">" } else { " " };
        println!(
            "  {marker} {:<34} {:<34} {}",
            row.primary, row.secondary, row.keys
        );
    }
}

fn main() -> io::Result<()> {
    let mut session = ModalSession::new();
    let mut last_generation = 0;
    let stdin = io::stdin();
    let mut out = io::stdout();
    println!("modalctl: type 'help' for commands");
    loop {
        print!("[{}] > ", session.mode().indicator());
        out.flush()?;
        let mut line = String::new();
        if stdin.lock().read_line(&mut line)? == 0 {
            return Ok(());
        }
        let line = line.trim();
        let (verb, rest) = line.split_once(' ').unwrap_or((line, ""));
        match verb {
            "" => {}
            "quit" | "exit" => return Ok(()),
            "help" => println!(
                "keys <seq> | keys! <seq> | :<command> | focus <page|editable|rich|ui> | timeout | complete <text> | hints <n> | palette[!] <text> | page <host> | config <file> | quit"
            ),
            "keys" | "keys!" => {
                let focus = if verb == "keys!" {
                    FocusContext::EDITABLE
                } else {
                    FocusContext::PAGE
                };
                match KeySequence::parse(rest) {
                    Ok(seq) => {
                        for &key in seq.keys() {
                            let outcome = session.handle_key(key, &focus);
                            track(&outcome, &mut last_generation);
                            print_outcome(&key.to_string(), &outcome);
                        }
                        print_palette(&session);
                    }
                    Err(e) => println!("bad keys: {e}"),
                }
            }
            "focus" => match focus_from(rest) {
                Some(focus) => print_outcome("focus", &session.on_focus_changed(&focus)),
                None => println!("focus page|editable|rich|ui"),
            },
            "timeout" => print_outcome("timeout", &session.on_timeout()),
            "hints" => {
                let n: usize = rest.parse().unwrap_or(10);
                let o = session.hints_collected(last_generation, &vec![HintKind::Link; n]);
                print_outcome("hints", &o);
            }
            "palette" | "palette!" => {
                let o = session.palette_input(rest);
                print_outcome("palette", &o);
                if verb == "palette!" {
                    print_outcome("enter", &session.palette_key(PaletteKey::Accept));
                }
                print_palette(&session);
            }
            "page" => print_outcome("page", &session.on_page_changed(rest)),
            "config" => match std::fs::read_to_string(rest) {
                Ok(text) => {
                    let report = session.load_config(&text);
                    for e in &report.errors {
                        println!("  !! {e}");
                    }
                    println!("  {} bindings", report.bindings);
                }
                Err(e) => println!("{rest}: {e}"),
            },
            "complete" => {
                for c in session.complete(rest) {
                    println!("  {:<20} {}", c.text, c.summary);
                }
            }
            _ if line.starts_with(':') => {
                print_outcome("submit", &session.submit_command_line(line));
            }
            _ => println!("unknown input; type 'help'"),
        }
    }
}

/// Remembers the generation of the latest hint request.
fn track(o: &Outcome, last_generation: &mut u32) {
    for a in &o.actions {
        if let Action::CollectHints { generation, .. } = a {
            *last_generation = *generation;
        }
    }
}
