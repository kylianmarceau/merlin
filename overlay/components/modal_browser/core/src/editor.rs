//! Editing page fields in an external editor (`:edit`).
//!
//! The host reports what the focused field is (never its value at this
//! stage); the core decides whether it may leave the browser and which
//! program to run. The host then writes the text to a private temporary
//! file, starts the editor without a shell, and writes saved text back only
//! into the same field on the same page.
//!
//! Password fields and fields marked for payment or one-time codes never
//! leave. Fields that merely *look* sensitive by name are refused unless
//! the user insists with `:edit!`.

/// Largest field text sent to an editor.
pub const MAX_FIELD_LEN: usize = 1024 * 1024;
/// Most arguments in an editor command.
pub const MAX_EDITOR_ARGS: usize = 32;
/// Placeholder for the file path in the `editor` option.
pub const FILE_PLACEHOLDER: &str = "{file}";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum FieldKind {
    /// No editable element has focus.
    None,
    /// `<input>` of a text-like type.
    Input,
    TextArea,
    /// `contenteditable` (rich editors).
    ContentEditable,
}

/// What the host knows about the focused field, lowercased.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FieldInfo {
    pub kind: FieldKind,
    /// `type` attribute of an input.
    pub input_type: String,
    /// `autocomplete` attribute.
    pub autocomplete: String,
    /// `name`, `id` and `aria-label`, joined.
    pub label: String,
    /// Length of the current value, in UTF-16 units.
    pub length: usize,
    pub read_only: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EditDecision {
    Allowed,
    Refused(String),
}

/// Input types whose text can sensibly be edited as a file.
const TEXT_TYPES: &[&str] = &["", "text", "search", "url", "email", "tel"];

/// `autocomplete` tokens that mark secrets or payment data.
const SECRET_AUTOCOMPLETE: &[&str] = &[
    "current-password",
    "new-password",
    "one-time-code",
    "cc-name",
    "cc-given-name",
    "cc-additional-name",
    "cc-family-name",
    "cc-number",
    "cc-exp",
    "cc-exp-month",
    "cc-exp-year",
    "cc-csc",
    "cc-type",
    "transaction-amount",
];

/// Words in a field's name that suggest it holds something sensitive.
const SENSITIVE_WORDS: &[&str] = &[
    "password", "passwd", "passcode", "secret", "token", "otp", "cvc", "cvv", "card", "iban",
    "ssn", "pin",
];

fn label_words(label: &str) -> impl Iterator<Item = &str> {
    label
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|w| !w.is_empty())
}

/// Decides whether the field may be edited externally. `force` (`:edit!`)
/// overrides name-based guesses, never declared secrets.
pub fn decide(info: &FieldInfo, force: bool) -> EditDecision {
    let refuse = |why: &str| EditDecision::Refused(why.to_string());
    match info.kind {
        FieldKind::None => return refuse("No text field has focus (gi focuses one)"),
        FieldKind::Input if !TEXT_TYPES.contains(&info.input_type.as_str()) => {
            return if info.input_type == "password" {
                refuse("Password fields never leave the browser")
            } else {
                refuse("This field does not hold text")
            };
        }
        _ => {}
    }
    if info.read_only {
        return refuse("This field is read-only");
    }
    if info
        .autocomplete
        .split_whitespace()
        .any(|t| SECRET_AUTOCOMPLETE.contains(&t))
    {
        return refuse("This field is marked as a password or payment field");
    }
    if info.length > MAX_FIELD_LEN {
        return refuse("This field holds more than 1 MiB of text");
    }
    if !force
        && label_words(&info.label.to_ascii_lowercase()).any(|w| {
            SENSITIVE_WORDS.contains(&w)
                || (w.len() > 4
                    && SENSITIVE_WORDS
                        .iter()
                        .any(|s| s.len() > 3 && w.starts_with(s)))
        })
    {
        return refuse("This field looks sensitive; :edit! opens it anyway");
    }
    EditDecision::Allowed
}

/// The editor command, with [`FILE_PLACEHOLDER`] where the file path goes.
///
/// The `editor` option wins. Otherwise `$VISUAL`, then `$EDITOR`, split on
/// whitespace (no shell, so no quoting or expansion), with the file
/// appended. A terminal editor such as Neovim needs a terminal to run in,
/// which a GUI app does not have: configure one explicitly, for example
/// `editor = ["/Applications/Ghostty.app/Contents/MacOS/ghostty", "--quit-after-last-window-closed=true", "-e", "nvim", "{file}"]`.
pub fn command(configured: &[String], visual: &str, editor: &str) -> Result<Vec<String>, String> {
    let mut argv: Vec<String> = if !configured.is_empty() {
        configured.to_vec()
    } else {
        let from_env = if !visual.trim().is_empty() {
            visual
        } else {
            editor
        };
        let words: Vec<String> = from_env.split_whitespace().map(str::to_string).collect();
        if words.is_empty() {
            return Err(
                "No editor configured: set editor = [\"/Applications/Ghostty.app/Contents/MacOS/ghostty\", \"-e\", \"nvim\", \"{file}\"] \
                 in config.toml, or $VISUAL"
                    .to_string(),
            );
        }
        words
    };
    if argv.len() > MAX_EDITOR_ARGS {
        return Err(format!(
            "the editor command has more than {MAX_EDITOR_ARGS} arguments"
        ));
    }
    if argv[0].trim().is_empty() {
        return Err("the editor command is empty".to_string());
    }
    if !argv.iter().any(|a| a.contains(FILE_PLACEHOLDER)) {
        argv.push(FILE_PLACEHOLDER.to_string());
    }
    Ok(argv)
}

/// Replaces the placeholder in every argument with `path`.
pub fn substitute(argv: &[String], path: &str) -> Vec<String> {
    argv.iter()
        .map(|a| a.replace(FILE_PLACEHOLDER, path))
        .collect()
}
