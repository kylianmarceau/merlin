//! Pages as structured documents.
//!
//! The host extracts a page's readable structure in Chrome's isolated world
//! (headings, paragraphs, lists, code, quotes, tables, with inline links and
//! code marked as spans) and hands it over as [`Block`]s. The core turns
//! that into an outline to search and jump through, and renders Markdown,
//! plain text, link lists and code for copying or for an external editor.
//!
//! Page content is untrusted: everything is bounded on the way in, link
//! targets are limited to web and mail URLs, and nothing here is persisted.

use std::fmt::Write as _;

/// Most blocks kept from one page.
pub const MAX_BLOCKS: usize = 5000;
/// Most characters kept from one block.
pub const MAX_BLOCK_TEXT: usize = 64 * 1024;
/// Most characters kept from one page in total.
pub const MAX_DOCUMENT_TEXT: usize = 2 * 1024 * 1024;
/// Most spans kept per block.
pub const MAX_SPANS: usize = 256;
/// No index into the host's element list.
pub const NO_ELEMENT: u32 = u32::MAX;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum BlockKind {
    /// `level` 1..=6.
    Heading,
    Paragraph,
    /// `level` is the nesting depth, from 1.
    ListItem,
    /// Preformatted code; `lang` may name the language.
    Code,
    Quote,
    /// One table row; cells separated by `\t`. `header` marks header rows;
    /// `level` numbers the table, so consecutive rows of different tables
    /// stay apart.
    TableRow,
    Rule,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum SpanKind {
    Link,
    Code,
    Strong,
    Emphasis,
}

/// Inline markup over `Block::text`, in character offsets.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Span {
    pub start: usize,
    pub end: usize,
    pub kind: SpanKind,
    /// Link target; empty for other kinds and for links that are not
    /// web or mail URLs.
    pub href: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Block {
    pub kind: BlockKind,
    pub level: u8,
    pub ordered: bool,
    pub header: bool,
    pub lang: String,
    pub text: String,
    pub spans: Vec<Span>,
    /// Index into the host's element list, for jumping back to the live
    /// page; [`NO_ELEMENT`] if none.
    pub element: u32,
}

impl Block {
    pub fn new(kind: BlockKind, text: &str) -> Self {
        Block {
            kind,
            level: 1,
            ordered: false,
            header: false,
            lang: String::new(),
            text: text.to_string(),
            spans: Vec::new(),
            element: NO_ELEMENT,
        }
    }
}

/// One page's structure.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PageDocument {
    pub title: String,
    pub url: String,
    pub blocks: Vec<Block>,
    /// Whether limits cut anything off.
    pub truncated: bool,
}

/// What `:extract` produces.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ExtractKind {
    Markdown,
    Text,
    Links,
    Code,
    Headings,
}

impl ExtractKind {
    pub const ALL: [(ExtractKind, &'static str, &'static str); 5] = [
        (ExtractKind::Markdown, "markdown", "the page as Markdown"),
        (ExtractKind::Text, "text", "the page as plain text"),
        (
            ExtractKind::Links,
            "links",
            "every link, as a Markdown list",
        ),
        (ExtractKind::Code, "code", "every code block"),
        (
            ExtractKind::Headings,
            "headings",
            "the outline, as a Markdown list",
        ),
    ];

    pub fn from_name(name: &str) -> Option<ExtractKind> {
        Self::ALL
            .iter()
            .find(|(_, n, _)| *n == name)
            .map(|(k, _, _)| *k)
    }

    pub fn name(self) -> &'static str {
        Self::ALL
            .iter()
            .find(|(k, _, _)| *k == self)
            .map(|(_, n, _)| *n)
            .unwrap_or("markdown")
    }

    /// File extension for the editor's temporary file.
    pub fn extension(self) -> &'static str {
        match self {
            ExtractKind::Text => "txt",
            _ => "md",
        }
    }
}

/// An outline entry: a heading, code block or table, with its depth in
/// the heading tree.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OutlineEntry {
    pub kind: BlockKind,
    /// Heading level for headings; for code and tables, one deeper than
    /// the heading they sit under.
    pub depth: u8,
    pub label: String,
    pub detail: String,
    pub element: u32,
}

fn truncate_chars(s: &mut String, max: usize) -> bool {
    if let Some((i, _)) = s.char_indices().nth(max) {
        s.truncate(i);
        true
    } else {
        false
    }
}

/// Whether a link target may be offered as a link. Anything else is kept as
/// plain text, so a page cannot slip `javascript:` or `chrome:` URLs into a
/// copied document or the links list.
pub fn is_safe_href(href: &str) -> bool {
    let lower = href.trim_start().to_ascii_lowercase();
    lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("mailto:")
}

/// Converts UTF-16 offsets (what JavaScript reports) into character
/// offsets. Offsets inside a surrogate pair round down.
pub fn utf16_to_char_offsets(text: &str, offsets: &[usize]) -> Vec<usize> {
    let mut boundaries = Vec::with_capacity(text.len() + 1);
    let mut u16_pos = 0;
    for (i, c) in text.chars().enumerate() {
        for _ in 0..c.len_utf16() {
            boundaries.push(i);
        }
        u16_pos += c.len_utf16();
    }
    let total_chars = text.chars().count();
    offsets
        .iter()
        .map(|&o| {
            if o >= u16_pos {
                total_chars
            } else {
                boundaries[o]
            }
        })
        .collect()
}

impl PageDocument {
    /// Builds a document from host data, enforcing every bound: block
    /// count, text per block and per page, span ranges and link schemes.
    pub fn new(title: &str, url: &str, blocks: Vec<Block>) -> Self {
        let mut doc = PageDocument {
            title: title.chars().take(1024).collect(),
            url: url.chars().take(8192).collect(),
            blocks: Vec::new(),
            truncated: false,
        };
        let mut total = 0usize;
        for mut b in blocks {
            if doc.blocks.len() >= MAX_BLOCKS || total >= MAX_DOCUMENT_TEXT {
                doc.truncated = true;
                break;
            }
            let room = MAX_BLOCK_TEXT.min(MAX_DOCUMENT_TEXT - total);
            if truncate_chars(&mut b.text, room) {
                doc.truncated = true;
            }
            let len = b.text.chars().count();
            total += len;
            b.level = match b.kind {
                BlockKind::Heading => b.level.clamp(1, 6),
                BlockKind::ListItem => b.level.clamp(1, 8),
                _ => b.level.max(1),
            };
            b.lang
                .retain(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '+' | '_' | '#'));
            truncate_chars(&mut b.lang, 32);
            b.spans.truncate(MAX_SPANS);
            b.spans.retain_mut(|s| {
                s.end = s.end.min(len);
                if s.kind == SpanKind::Link && !is_safe_href(&s.href) {
                    s.href.clear();
                }
                if s.kind != SpanKind::Link {
                    s.href.clear();
                }
                truncate_chars(&mut s.href, 8192);
                s.start < s.end
            });
            b.spans.sort_by_key(|s| (s.start, std::cmp::Reverse(s.end)));
            doc.blocks.push(b);
        }
        doc
    }

    /// Headings, code blocks and tables in page order.
    pub fn outline(&self) -> Vec<OutlineEntry> {
        let min_level = self
            .blocks
            .iter()
            .filter(|b| b.kind == BlockKind::Heading)
            .map(|b| b.level)
            .min()
            .unwrap_or(1);
        let mut out = Vec::new();
        let mut section_depth = 0u8;
        let mut last_table = None;
        for b in &self.blocks {
            match b.kind {
                BlockKind::Heading => {
                    let depth = b.level - min_level + 1;
                    section_depth = depth;
                    let label = one_line(&b.text, 120);
                    if label.is_empty() {
                        continue;
                    }
                    out.push(OutlineEntry {
                        kind: b.kind,
                        depth,
                        label,
                        detail: format!("H{}", b.level),
                        element: b.element,
                    });
                }
                BlockKind::Code => {
                    let first = b.text.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
                    out.push(OutlineEntry {
                        kind: b.kind,
                        depth: section_depth + 1,
                        label: one_line(first, 100),
                        detail: if b.lang.is_empty() {
                            "code".into()
                        } else {
                            format!("code · {}", b.lang)
                        },
                        element: b.element,
                    });
                }
                BlockKind::TableRow if last_table != Some(b.level) => {
                    last_table = Some(b.level);
                    out.push(OutlineEntry {
                        kind: b.kind,
                        depth: section_depth + 1,
                        label: one_line(&b.text.replace('\t', " · "), 100),
                        detail: "table".into(),
                        element: b.element,
                    });
                }
                _ => {}
            }
        }
        out
    }

    /// Links in page order, each URL once: (text, url).
    pub fn links(&self) -> Vec<(String, String)> {
        let mut out: Vec<(String, String)> = Vec::new();
        for b in &self.blocks {
            for s in &b.spans {
                if s.kind != SpanKind::Link || s.href.is_empty() {
                    continue;
                }
                if out.iter().any(|(_, u)| *u == s.href) {
                    continue;
                }
                let text = one_line(&slice_chars(&b.text, s.start, s.end), 200);
                out.push((
                    if text.is_empty() {
                        s.href.clone()
                    } else {
                        text
                    },
                    s.href.clone(),
                ));
            }
        }
        out
    }

    pub fn render(&self, kind: ExtractKind) -> String {
        match kind {
            ExtractKind::Markdown => self.to_markdown(),
            ExtractKind::Text => self.to_text(),
            ExtractKind::Links => {
                let mut out = String::new();
                for (text, url) in self.links() {
                    let _ = writeln!(out, "- [{}]({})", escape_link_text(&text), escape_url(&url));
                }
                out
            }
            ExtractKind::Code => {
                let mut out = String::new();
                for b in self.blocks.iter().filter(|b| b.kind == BlockKind::Code) {
                    if !out.is_empty() {
                        out.push('\n');
                    }
                    push_code_block(&mut out, &b.text, &b.lang);
                }
                out
            }
            ExtractKind::Headings => {
                let mut out = String::new();
                for e in self
                    .outline()
                    .iter()
                    .filter(|e| e.kind == BlockKind::Heading)
                {
                    let indent = "  ".repeat(usize::from(e.depth.saturating_sub(1)));
                    let _ = writeln!(out, "{indent}- {}", escape_inline(&e.label));
                }
                out
            }
        }
    }

    pub fn to_text(&self) -> String {
        let mut out = String::new();
        if !self.title.is_empty() {
            out.push_str(&self.title);
            out.push_str("\n\n");
        }
        for (i, b) in self.blocks.iter().enumerate() {
            match b.kind {
                BlockKind::Rule => continue,
                BlockKind::TableRow => {
                    out.push_str(&b.text);
                    out.push('\n');
                    let next_is_row = self
                        .blocks
                        .get(i + 1)
                        .is_some_and(|n| n.kind == BlockKind::TableRow && n.level == b.level);
                    if !next_is_row {
                        out.push('\n');
                    }
                }
                BlockKind::ListItem => {
                    out.push_str(&"  ".repeat(usize::from(b.level - 1)));
                    out.push_str("- ");
                    out.push_str(b.text.trim());
                    out.push('\n');
                    let next_is_item = self
                        .blocks
                        .get(i + 1)
                        .is_some_and(|n| n.kind == BlockKind::ListItem);
                    if !next_is_item {
                        out.push('\n');
                    }
                }
                _ => {
                    out.push_str(b.text.trim_end());
                    out.push_str("\n\n");
                }
            }
        }
        out.truncate(out.trim_end().len());
        out.push('\n');
        out
    }

    pub fn to_markdown(&self) -> String {
        let mut out = String::new();
        if !self.title.is_empty() {
            let _ = write!(out, "# {}\n\n", escape_inline(&one_line(&self.title, 300)));
        }
        if !self.url.is_empty() {
            let _ = write!(out, "<{}>\n\n", escape_url(&self.url));
        }
        let mut i = 0;
        while i < self.blocks.len() {
            let b = &self.blocks[i];
            match b.kind {
                BlockKind::Heading => {
                    let text = render_inline(b);
                    if !text.trim().is_empty() {
                        let _ = write!(
                            out,
                            "{} {}\n\n",
                            "#".repeat(usize::from(b.level)),
                            one_line(&text, 2000)
                        );
                    }
                }
                BlockKind::Paragraph => {
                    let text = render_inline(b);
                    if !text.trim().is_empty() {
                        for line in text.trim().lines() {
                            out.push_str(&escape_line_start(line));
                            out.push('\n');
                        }
                        out.push('\n');
                    }
                }
                BlockKind::Quote => {
                    for line in render_inline(b).trim().lines() {
                        out.push_str("> ");
                        out.push_str(&escape_line_start(line));
                        out.push('\n');
                    }
                    out.push('\n');
                }
                BlockKind::Code => {
                    push_code_block(&mut out, &b.text, &b.lang);
                    out.push('\n');
                }
                BlockKind::Rule => out.push_str("---\n\n"),
                BlockKind::ListItem => {
                    // A run of items, numbered per depth.
                    let mut numbers = [0u32; 9];
                    while let Some(item) =
                        self.blocks.get(i).filter(|b| b.kind == BlockKind::ListItem)
                    {
                        let depth = usize::from(item.level);
                        numbers[depth] += 1;
                        for n in numbers.iter_mut().skip(depth + 1) {
                            *n = 0;
                        }
                        let marker = if item.ordered {
                            format!("{}.", numbers[depth])
                        } else {
                            "-".to_string()
                        };
                        let _ = writeln!(
                            out,
                            "{}{marker} {}",
                            "  ".repeat(depth - 1),
                            one_line(&render_inline(item), 4000)
                        );
                        i += 1;
                    }
                    out.push('\n');
                    continue;
                }
                BlockKind::TableRow => {
                    let table = b.level;
                    let start = i;
                    while self
                        .blocks
                        .get(i)
                        .is_some_and(|r| r.kind == BlockKind::TableRow && r.level == table)
                    {
                        i += 1;
                    }
                    push_table(&mut out, &self.blocks[start..i]);
                    out.push('\n');
                    continue;
                }
            }
            i += 1;
        }
        out.truncate(out.trim_end().len());
        out.push('\n');
        out
    }
}

fn one_line(s: &str, max: usize) -> String {
    let joined = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if joined.chars().count() > max {
        let mut cut: String = joined.chars().take(max.saturating_sub(1)).collect();
        cut.push('…');
        cut
    } else {
        joined
    }
}

fn slice_chars(s: &str, start: usize, end: usize) -> String {
    s.chars()
        .skip(start)
        .take(end.saturating_sub(start))
        .collect()
}

/// Escapes characters that would otherwise start Markdown syntax inside
/// running text.
fn escape_inline(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if matches!(c, '\\' | '`' | '*' | '_' | '[' | ']' | '<' | '>' | '|') {
            out.push('\\');
        }
        out.push(c);
    }
    // Line starts that would become a heading, quote or list.
    let trimmed = out.trim_start();
    if trimmed.starts_with('#')
        || trimmed.starts_with("- ")
        || trimmed.starts_with("+ ")
        || trimmed
            .split_once(". ")
            .is_some_and(|(n, _)| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
    {
        let offset = out.len() - trimmed.len();
        out.insert(offset, '\\');
    }
    out
}

/// Escapes a line start that Markdown would read as a heading or a list
/// item. Text inside lines is escaped by [`escape_text`].
fn escape_line_start(line: &str) -> String {
    let trimmed = line.trim_start();
    let indent = &line[..line.len() - trimmed.len()];
    let numbered = trimmed.split_once(['.', ')']).is_some_and(|(n, rest)| {
        !n.is_empty()
            && n.len() <= 9
            && n.chars().all(|c| c.is_ascii_digit())
            && (rest.is_empty() || rest.starts_with(' '))
    });
    if trimmed.starts_with('#')
        || trimmed.starts_with("- ")
        || trimmed.starts_with("+ ")
        || trimmed == "-"
        || trimmed.starts_with("===")
        || trimmed.starts_with("---")
    {
        format!("{indent}\\{trimmed}")
    } else if numbered {
        // "1. x" -> "1\. x"
        let digits = trimmed.chars().take_while(char::is_ascii_digit).count();
        format!("{indent}{}\\{}", &trimmed[..digits], &trimmed[digits..])
    } else {
        line.to_string()
    }
}

fn escape_link_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if matches!(c, '\\' | '[' | ']') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

fn escape_url(url: &str) -> String {
    url.replace('(', "%28")
        .replace(')', "%29")
        .replace(' ', "%20")
        .replace('<', "%3C")
        .replace('>', "%3E")
}

fn inline_code(s: &str) -> String {
    let longest = longest_run(s, '`');
    let fence = "`".repeat(longest + 1);
    let pad = if s.starts_with('`') || s.ends_with('`') {
        " "
    } else {
        ""
    };
    format!("{fence}{pad}{s}{pad}{fence}")
}

fn longest_run(s: &str, c: char) -> usize {
    let mut best = 0;
    let mut run = 0;
    for ch in s.chars() {
        if ch == c {
            run += 1;
            best = best.max(run);
        } else {
            run = 0;
        }
    }
    best
}

fn push_code_block(out: &mut String, code: &str, lang: &str) {
    let fence = "`".repeat(longest_run(code, '`').max(2) + 1);
    let _ = writeln!(out, "{fence}{lang}");
    out.push_str(code.trim_end_matches('\n'));
    out.push('\n');
    let _ = writeln!(out, "{fence}");
}

fn push_table(out: &mut String, rows: &[Block]) {
    let cells: Vec<Vec<String>> = rows
        .iter()
        .map(|r| {
            r.text
                .split('\t')
                .map(|c| escape_inline(&one_line(c, 500)))
                .collect()
        })
        .collect();
    let width = cells.iter().map(Vec::len).max().unwrap_or(0).max(1);
    let line = |row: &[String]| {
        let mut s = String::from("|");
        for i in 0..width {
            s.push(' ');
            s.push_str(row.get(i).map(String::as_str).unwrap_or(""));
            s.push_str(" |");
        }
        s
    };
    // Markdown tables need a header; use the first row.
    let _ = writeln!(out, "{}", line(&cells[0]));
    let _ = writeln!(out, "|{}", " --- |".repeat(width));
    for row in &cells[1..] {
        let _ = writeln!(out, "{}", line(row));
    }
}

/// Renders a block's text with its spans as Markdown. Spans nest only if
/// they are properly contained; overlapping ones are dropped.
fn render_inline(b: &Block) -> String {
    let chars: Vec<char> = b.text.chars().collect();
    // Keep a properly nested subset of spans.
    let mut kept: Vec<&Span> = Vec::new();
    let mut stack: Vec<&Span> = Vec::new();
    for s in &b.spans {
        while stack.last().is_some_and(|top| top.end <= s.start) {
            stack.pop();
        }
        if stack.last().is_some_and(|top| s.end > top.end) {
            continue;
        }
        // Inside inline code nothing else applies.
        if stack.iter().any(|t| t.kind == SpanKind::Code) {
            continue;
        }
        stack.push(s);
        kept.push(s);
    }
    render_range(&chars, 0, chars.len(), &kept)
}

fn render_range(chars: &[char], start: usize, end: usize, spans: &[&Span]) -> String {
    let mut out = String::new();
    let mut pos = start;
    let mut i = 0;
    while i < spans.len() {
        let s = spans[i];
        if s.start < pos || s.end > end {
            i += 1;
            continue;
        }
        out.push_str(&escape_text(&chars[pos..s.start]));
        // Children: spans inside this one.
        let mut j = i + 1;
        while j < spans.len() && spans[j].start < s.end {
            j += 1;
        }
        let inner = &spans[i + 1..j];
        let text: String = chars[s.start..s.end].iter().collect();
        let rendered = match s.kind {
            SpanKind::Code => inline_code(&text),
            SpanKind::Strong | SpanKind::Emphasis => {
                let body = render_range(chars, s.start, s.end, inner);
                let trimmed = body.trim();
                if trimmed.is_empty() {
                    body
                } else {
                    let mark = if s.kind == SpanKind::Strong {
                        "**"
                    } else {
                        "_"
                    };
                    let lead = &body[..body.len() - body.trim_start().len()];
                    let trail = &body[body.trim_end().len()..];
                    format!("{lead}{mark}{trimmed}{mark}{trail}")
                }
            }
            SpanKind::Link => {
                let body = render_range(chars, s.start, s.end, inner);
                if s.href.is_empty() || body.trim().is_empty() {
                    body
                } else {
                    format!("[{}]({})", body, escape_url(&s.href))
                }
            }
        };
        out.push_str(&rendered);
        pos = s.end;
        i = j;
    }
    out.push_str(&escape_text(&chars[pos..end]));
    out
}

fn escape_text(chars: &[char]) -> String {
    let s: String = chars.iter().collect();
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if matches!(c, '\\' | '`' | '*' | '_' | '[' | ']' | '<' | '>') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}
