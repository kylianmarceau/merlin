use modal_browser_core::document::{self, NO_ELEMENT, utf16_to_char_offsets};
use modal_browser_core::{Block, BlockKind, ExtractKind, PageDocument, Span, SpanKind};

fn block(kind: BlockKind, level: u8, text: &str) -> Block {
    Block {
        level,
        ..Block::new(kind, text)
    }
}

fn span(start: usize, end: usize, kind: SpanKind, href: &str) -> Span {
    Span {
        start,
        end,
        kind,
        href: href.into(),
    }
}

fn sample() -> PageDocument {
    let mut intro = block(BlockKind::Paragraph, 1, "Read the docs or call foo() now.");
    intro.spans = vec![
        span(9, 13, SpanKind::Link, "https://docs.rs/foo"),
        span(22, 27, SpanKind::Code, ""),
        span(0, 4, SpanKind::Strong, ""),
    ];
    let mut evil = block(BlockKind::Paragraph, 1, "click me");
    evil.spans = vec![span(0, 5, SpanKind::Link, "javascript:alert(1)")];
    let mut code = block(
        BlockKind::Code,
        1,
        "fn main() {\n    println!(\"```\");\n}\n",
    );
    code.lang = "rust".into();
    code.element = 3;
    let mut h1 = block(BlockKind::Heading, 2, "Getting   started");
    h1.element = 0;
    let mut h2 = block(BlockKind::Heading, 3, "Install");
    h2.element = 1;
    let mut row1 = block(BlockKind::TableRow, 1, "Name\tValue");
    row1.header = true;
    row1.element = 4;
    let row2 = block(BlockKind::TableRow, 1, "a|b\t2");
    let mut ordered = block(BlockKind::ListItem, 1, "first");
    ordered.ordered = true;
    let mut ordered2 = block(BlockKind::ListItem, 1, "second");
    ordered2.ordered = true;
    let nested = block(BlockKind::ListItem, 2, "nested");
    let mut h3 = block(BlockKind::Heading, 2, "Usage");
    h3.element = 5;
    PageDocument::new(
        "Foo crate",
        "https://docs.rs/foo",
        vec![
            h1,
            intro,
            h2,
            code,
            evil,
            row1,
            row2,
            ordered,
            ordered2,
            nested,
            block(BlockKind::Quote, 1, "# not a heading"),
            block(BlockKind::Rule, 1, ""),
            h3,
        ],
    )
}

#[test]
fn markdown_rendering() {
    let md = sample().to_markdown();
    let expected = "# Foo crate

<https://docs.rs/foo>

## Getting started

**Read** the [docs](https://docs.rs/foo) or call `foo()` now.

### Install

````rust
fn main() {
    println!(\"```\");
}
````

click me

| Name | Value |
| --- | --- |
| a\\|b | 2 |

1. first
2. second
  - nested

> \\# not a heading

---

## Usage
";
    assert_eq!(md, expected);
}

#[test]
fn script_links_never_become_links() {
    let doc = sample();
    assert!(!doc.to_markdown().contains("javascript"));
    assert_eq!(
        doc.links(),
        vec![("docs".to_string(), "https://docs.rs/foo".to_string())]
    );
    assert!(document::is_safe_href("mailto:a@b.c"));
    assert!(!document::is_safe_href("chrome://settings"));
}

#[test]
fn outline_has_depths_relative_to_the_top_heading() {
    let outline = sample().outline();
    let summary: Vec<(BlockKind, u8, &str, &str, u32)> = outline
        .iter()
        .map(|e| {
            (
                e.kind,
                e.depth,
                e.label.as_str(),
                e.detail.as_str(),
                e.element,
            )
        })
        .collect();
    assert_eq!(
        summary,
        vec![
            (BlockKind::Heading, 1, "Getting started", "H2", 0),
            (BlockKind::Heading, 2, "Install", "H3", 1),
            (BlockKind::Code, 3, "fn main() {", "code · rust", 3),
            (BlockKind::TableRow, 3, "Name · Value", "table", 4),
            (BlockKind::Heading, 1, "Usage", "H2", 5),
        ]
    );
}

#[test]
fn other_renderings() {
    let doc = sample();
    assert_eq!(
        doc.render(ExtractKind::Links),
        "- [docs](https://docs.rs/foo)\n"
    );
    assert!(
        doc.render(ExtractKind::Code)
            .starts_with("````rust\nfn main()")
    );
    assert_eq!(
        doc.render(ExtractKind::Headings),
        "- Getting started\n  - Install\n- Usage\n"
    );
    let text = doc.render(ExtractKind::Text);
    assert!(text.starts_with("Foo crate\n\nGetting   started\n\nRead the docs"));
    assert!(text.contains("Name\tValue\na|b\t2\n\n"));
    assert!(!text.contains('*'));
}

#[test]
fn limits_and_bad_spans() {
    let mut b = block(BlockKind::Paragraph, 1, "short");
    b.spans = vec![
        span(3, 99, SpanKind::Emphasis, "ignored"),
        span(4, 2, SpanKind::Code, ""),
    ];
    b.lang = "rust<script>".into();
    let huge = block(
        BlockKind::Paragraph,
        1,
        &"x".repeat(document::MAX_BLOCK_TEXT + 10),
    );
    let mut heading = block(BlockKind::Heading, 9, "deep");
    heading.element = NO_ELEMENT;
    let doc = PageDocument::new("t", "u", vec![b, huge, heading]);
    assert!(doc.truncated);
    assert_eq!(doc.blocks[0].spans.len(), 1);
    assert_eq!(doc.blocks[0].spans[0].end, 5);
    assert!(doc.blocks[0].spans[0].href.is_empty());
    assert_eq!(doc.blocks[0].lang, "rustscript");
    assert_eq!(doc.blocks[1].text.chars().count(), document::MAX_BLOCK_TEXT);
    assert_eq!(doc.blocks[2].level, 6);

    let many: Vec<Block> = (0..document::MAX_BLOCKS + 5)
        .map(|_| block(BlockKind::Paragraph, 1, "p"))
        .collect();
    let doc = PageDocument::new("", "", many);
    assert_eq!(doc.blocks.len(), document::MAX_BLOCKS);
}

#[test]
fn overlapping_spans_are_dropped_not_garbled() {
    let mut b = block(BlockKind::Paragraph, 1, "abcdefgh");
    b.spans = vec![
        span(0, 4, SpanKind::Strong, ""),
        span(2, 6, SpanKind::Emphasis, ""),
        span(1, 3, SpanKind::Code, ""),
    ];
    let doc = PageDocument::new("", "", vec![b]);
    assert_eq!(doc.to_markdown(), "**a`bc`d**efgh\n");
}

#[test]
fn paragraph_starts_that_look_like_syntax_are_escaped() {
    let doc = PageDocument::new(
        "",
        "",
        vec![
            block(BlockKind::Paragraph, 1, "# hashtag"),
            block(BlockKind::Paragraph, 1, "2026. A good year"),
            block(BlockKind::Paragraph, 1, "- dash"),
            block(BlockKind::Paragraph, 1, "plain 1. text"),
        ],
    );
    assert_eq!(
        doc.to_markdown(),
        "\\# hashtag\n\n2026\\. A good year\n\n\\- dash\n\nplain 1. text\n"
    );
}

#[test]
fn utf16_offsets_from_javascript() {
    // "a🦀b": a=0, crab=1..3 (two units), b=3.
    assert_eq!(
        utf16_to_char_offsets("a🦀b", &[0, 1, 2, 3, 4, 9]),
        vec![0, 1, 1, 2, 3, 3]
    );
}
