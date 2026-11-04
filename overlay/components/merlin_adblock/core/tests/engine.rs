use merlin_adblock_core::{Decision, Generation, List, ResourceType as Type};

fn lists(text: &str, permissions: u8) -> Vec<List> {
    vec![List {
        id: "fixture".into(),
        text: text.into(),
        permissions,
    }]
}
fn generation(text: &str) -> Generation {
    Generation::build(&lists(text, 0), "[]").unwrap()
}
fn check(g: &Generation, url: &str, source: &str, kind: Type) -> Decision {
    g.check(url, source, "GET", kind).unwrap()
}

#[test]
fn source_domain_type_method_and_public_suffix() {
    let with_port = generation("||ads.test^$script");
    assert_eq!(
        check(
            &with_port,
            "http://ads.test:12345/blocked.js",
            "http://news.test:12345/",
            Type::Script
        ),
        Decision::Block
    );
    let g = generation("||ads.test^$script,domain=news.co.uk,third-party,method=GET");
    let url = "https://ads.test/ad.js";
    assert_eq!(
        check(&g, url, "https://www.news.co.uk/story", Type::Script),
        Decision::Block
    );
    assert_eq!(
        check(&g, url, "https://other.co.uk/", Type::Script),
        Decision::Allow
    );
    assert_eq!(
        check(&g, url, "https://news.co.uk/", Type::Image),
        Decision::Allow
    );
    assert_eq!(
        g.check(url, "https://news.co.uk/", "POST", Type::Script)
            .unwrap(),
        Decision::Allow
    );
    let g = generation("||stats.example.co.uk^$third-party");
    assert_eq!(
        check(
            &g,
            "https://stats.example.co.uk/a",
            "https://www.example.co.uk/",
            Type::Script
        ),
        Decision::Allow
    );
    assert_eq!(
        check(
            &g,
            "https://stats.example.co.uk/a",
            "https://other.co.uk/",
            Type::Script
        ),
        Decision::Block
    );
}

#[test]
fn exceptions_important_and_internal_pages() {
    let g = generation(
        "||ads.test^\n@@||ads.test/ok.js$script\n||ads.test/important.js$important\n@@||ads.test/important.js",
    );
    assert_eq!(
        check(
            &g,
            "https://ads.test/ad.js",
            "https://news.test/",
            Type::Script
        ),
        Decision::Block
    );
    assert_eq!(
        check(
            &g,
            "https://ads.test/ok.js",
            "https://news.test/",
            Type::Script
        ),
        Decision::Allow
    );
    assert_eq!(
        check(
            &g,
            "https://ads.test/important.js",
            "https://news.test/",
            Type::Script
        ),
        Decision::Block
    );
    assert_eq!(
        check(
            &g,
            "https://ads.test/",
            "https://news.test/",
            Type::Document
        ),
        Decision::Allow
    );
    for url in [
        "chrome://ads.test/",
        "chrome-extension://ads.test/",
        "file:///ads.test",
    ] {
        assert_eq!(
            check(&g, url, "https://news.test/", Type::Other),
            Decision::Allow
        );
    }
}

#[test]
fn replacements_and_rewrites_are_distinct() {
    let resource = r#"[{"name":"noop.js","kind":{"mime":"application/javascript"},"content":"Lyogbm9vcCAqLw=="}]"#;
    let g = Generation::build(
        &lists(
            "||ads.test^$redirect=noop.js\n||news.test^$removeparam=tracking",
            0,
        ),
        resource,
    )
    .unwrap();
    assert_eq!(
        check(
            &g,
            "https://ads.test/ad.js",
            "https://news.test/",
            Type::Script
        ),
        Decision::Replace {
            mime: "application/javascript".into(),
            body: b"/* noop */".to_vec()
        }
    );
    assert_eq!(
        check(
            &g,
            "https://news.test/a?tracking=1&keep=2",
            "https://news.test/",
            Type::XmlHttpRequest
        ),
        Decision::Rewrite("https://news.test/a?keep=2".into())
    );
}

#[test]
fn redirect_rule_alone_does_not_block() {
    let g = generation("||ads.test^$redirect-rule=none");
    assert_eq!(
        check(
            &g,
            "https://ads.test/x.js",
            "https://news.test/",
            Type::Script
        ),
        Decision::Allow
    );
}

#[test]
fn cosmetics_respect_domain_generic_exceptions_and_generichide() {
    let g = generation(
        "news.test##.sponsor\n##.ad\nnews.test#@#.ad\nquiet.test##.quiet\n@@||quiet.test^$generichide",
    );
    let data = g.cosmetics("https://news.test/");
    assert!(data.hide_selectors.contains(&".sponsor".into()));
    assert!(!data.hide_selectors.contains(&".quiet".into()));
    assert!(
        g.generic_selectors(&["ad".into()], &[], &data.exceptions)
            .unwrap()
            .is_empty()
    );
    assert!(
        g.generic_selectors(&["ad".into()], &[], &[])
            .unwrap()
            .contains(&".ad".into())
    );
    assert!(g.cosmetics("https://quiet.test/").generichide);
}

#[test]
fn scriptlet_permissions_are_not_granted_to_untrusted_rules() {
    let resource = r#"[{"name":"trusted-test.js","kind":"template","content":"Z2xvYmFsVGhpcy5hZGJsb2NrRml4dHVyZSA9IHRydWU7","permission":1}]"#;
    let text = "news.test##+js(trusted-test)";
    let untrusted = Generation::build(&lists(text, 0), resource).unwrap();
    assert!(untrusted.cosmetics("https://news.test/").script.is_empty());
    let trusted = Generation::build(&lists(text, 1), resource).unwrap();
    assert!(
        trusted
            .cosmetics("https://news.test/")
            .script
            .contains("adblockFixture")
    );
}

#[test]
fn csp_is_additive_and_typed() {
    let g = generation("||news.test^$csp=script-src 'none'");
    assert_eq!(
        g.csp("https://news.test/frame", "https://news.test/")
            .unwrap(),
        "script-src 'none'"
    );
}

#[test]
fn corrupt_and_incompatible_caches_are_rejected_without_losing_rules() {
    let rules = lists("||ads.test^", 0);
    let original = Generation::build(&rules, "[]").unwrap();
    let cache = original.serialize();
    let loaded = Generation::load(&rules, "[]", &cache).unwrap();
    assert_eq!(
        check(
            &loaded,
            "https://ads.test/a",
            "https://news.test/",
            Type::Image
        ),
        Decision::Block
    );
    for len in [0, 8, cache.len() - 1] {
        assert!(Generation::load(&rules, "[]", &cache[..len]).is_err());
    }
    let mut corrupt = cache.clone();
    *corrupt.last_mut().unwrap() ^= 1;
    assert!(Generation::load(&rules, "[]", &corrupt).is_err());
    assert!(Generation::load(&lists("||other.test^", 0), "[]", &cache).is_err());
    assert!(Generation::load(&lists("||ads.test^", 1), "[]", &cache).is_err());
    assert!(Generation::load(&rules, "[ ]", &cache).is_err());
    assert_eq!(
        check(
            &original,
            "https://ads.test/a",
            "https://news.test/",
            Type::Image
        ),
        Decision::Block
    );
}

#[test]
fn malformed_bundles_and_dependency_cycles_are_rejected() {
    let rules = lists("||ads.test^", 0);
    for resource in [
        "garbage",
        r#"[{"name":"x","kind":"template","content":"!"}]"#,
        r#"[{"name":"x","kind":"template","content":"","aliases":["x"]}]"#,
        r#"[{"name":"x","kind":"template","content":"","dependencies":["missing"]}]"#,
        r#"[{"name":"x","kind":"template","content":"","dependencies":["x"]}]"#,
    ] {
        assert!(Generation::build(&rules, resource).is_err());
    }
}

#[test]
fn inputs_are_bounded_and_bad_enums_are_rejected() {
    let g = generation("||ads.test^");
    assert!(Type::try_from(255).is_err());
    assert!(
        g.check(
            "https://ads.test/",
            "https://news.test/",
            "GET\r\n",
            Type::Image
        )
        .is_err()
    );
    assert!(
        g.generic_selectors(&vec!["ad".into(); 1025], &[], &[])
            .is_err()
    );
    assert!(Generation::build(&[], "[]").is_err());
    assert!(Generation::build(&lists("! only a comment", 0), "[]").is_err());
}

#[test]
fn packaged_resources_validate_and_preserve_trust_metadata() {
    let resources = include_str!("../../resources/resources.json");
    Generation::build(&lists("||ads.test^", 0), resources).unwrap();
}

#[test]
fn packaged_function_scriptlets_keep_their_execution_world() {
    let resources = include_str!("../../resources/resources.json");
    let g = Generation::build(&lists("news.test##+js(set, merlinFixture, 42)\nnews.test##+js(set-attr, html, data-merlin, true)", 0), resources).unwrap();
    let data = g.cosmetics("https://news.test/");
    assert!(data.script.contains("function setConstant("));
    assert!(!data.script.contains("function setAttr("));
    assert!(data.isolated_script.contains("function setAttr("));
    assert!(!data.isolated_script.contains("function setConstant("));
}

#[test]
fn list_preprocessing_keeps_only_the_native_chromium_branch() {
    let rules = lists(
        "!#if cap_html_filtering\n||allowed.test^\n!#else\n||blocked.test^\n!#endif",
        0,
    );
    let g = Generation::build(&rules, "[]").unwrap();
    assert_eq!(
        check(
            &g,
            "https://allowed.test/a",
            "https://news.test/",
            Type::Image
        ),
        Decision::Allow
    );
    assert_eq!(
        check(
            &g,
            "https://blocked.test/a",
            "https://news.test/",
            Type::Image
        ),
        Decision::Block
    );
    assert!(
        Generation::build(
            &lists("!#if unknown_capability\n||ads.test^\n!#endif", 0),
            "[]"
        )
        .is_err()
    );
    assert!(
        Generation::build(
            &lists("!#include https://unapproved.test/rules\n||ads.test^", 0),
            "[]"
        )
        .is_err()
    );
}

#[test]
fn bundled_generation_builds_offline() {
    let manifest: serde_json::Value =
        serde_json::from_str(include_str!("../../resources/manifest.json")).unwrap();
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../resources");
    let lists: Vec<List> = manifest["sources"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| List {
            id: s["id"].as_str().unwrap().into(),
            text: std::fs::read_to_string(root.join(s["file"].as_str().unwrap())).unwrap(),
            permissions: s["permissions"].as_u64().unwrap() as u8,
        })
        .collect();
    let g = Generation::build(&lists, include_str!("../../resources/resources.json")).unwrap();
    assert!(g.audit.rules > 100_000);
    assert_eq!(
        g.audit.unsupported,
        g.audit.unsupported_reasons.values().sum::<usize>()
    );
    assert!(
        g.audit
            .unsupported_reasons
            .contains_key("cosmetic filter error: html filtering is unsupported")
    );
    assert!(
        !g.cosmetics("https://www.youtube.com/watch?v=fixture")
            .script
            .is_empty()
    );
}

#[test]
fn procedural_selectors_require_and_use_css_validation() {
    let g = generation(
        "news.test##.advert:has-text(Sponsored)\nnews.test##.advert:upward(1)\nnews.test##.prune:remove()",
    );
    let cosmetics = g.cosmetics("https://news.test/");
    assert!(cosmetics.hide_selectors.is_empty());
    assert_eq!(cosmetics.procedural_actions.len(), 3);
    assert!(
        cosmetics
            .procedural_actions
            .iter()
            .any(|r| r.contains("has-text"))
    );
    assert!(
        cosmetics
            .procedural_actions
            .iter()
            .any(|r| r.contains("upward"))
    );
}

#[test]
fn websocket_rules_do_not_block_unrelated_endpoints() {
    let g = generation("||ads.test^$websocket");
    assert_eq!(
        check(
            &g,
            "ws://ads.test:123/echo",
            "https://news.test/",
            Type::WebSocket
        ),
        Decision::Block
    );
    assert_eq!(
        check(
            &g,
            "wss://news.test:123/echo",
            "https://news.test/",
            Type::WebSocket
        ),
        Decision::Allow
    );
    assert_eq!(
        check(
            &g,
            "https://ads.test/echo",
            "https://news.test/",
            Type::XmlHttpRequest
        ),
        Decision::Allow
    );
}

#[test]
fn popup_rules_keep_their_type_domains_exceptions_and_priority() {
    let g = generation(
        "||ads.test^$popup,third-party,domain=news.test\n@@||allowed.ads.test^$popup\n||important.test^$popup,important\n@@||important.test^$popup",
    );
    assert_eq!(
        check(
            &g,
            "https://ads.test/open",
            "https://news.test/",
            Type::Popup
        ),
        Decision::Block
    );
    assert_eq!(
        check(
            &g,
            "https://ads.test/open",
            "https://elsewhere.test/",
            Type::Popup
        ),
        Decision::Allow
    );
    assert_eq!(
        check(
            &g,
            "https://ads.test/open",
            "https://news.test/",
            Type::Script
        ),
        Decision::Allow
    );
    assert_eq!(
        check(
            &g,
            "https://allowed.ads.test/open",
            "https://news.test/",
            Type::Popup
        ),
        Decision::Allow
    );
    assert_eq!(
        check(
            &g,
            "https://important.test/open",
            "https://news.test/",
            Type::Popup
        ),
        Decision::Block
    );
}

#[test]
fn mixed_and_negated_popup_types_do_not_broaden_normal_rules() {
    let g = generation(
        "||mixed.test^$popup,script\n||popup-only.test^$popup,~script\n||ordinary.test^$~popup\n||all.test^$all",
    );
    assert_eq!(
        check(
            &g,
            "https://mixed.test/ad",
            "https://news.test/",
            Type::Script
        ),
        Decision::Block
    );
    assert_eq!(
        check(
            &g,
            "https://mixed.test/ad",
            "https://news.test/",
            Type::Image
        ),
        Decision::Allow
    );
    assert_eq!(
        check(
            &g,
            "https://mixed.test/ad",
            "https://news.test/",
            Type::Popup
        ),
        Decision::Block
    );
    assert_eq!(
        check(
            &g,
            "https://popup-only.test/ad",
            "https://news.test/",
            Type::Script
        ),
        Decision::Allow
    );
    assert_eq!(
        check(
            &g,
            "https://popup-only.test/ad",
            "https://news.test/",
            Type::Popup
        ),
        Decision::Block
    );
    assert_eq!(
        check(
            &g,
            "https://ordinary.test/ad",
            "https://news.test/",
            Type::Popup
        ),
        Decision::Allow
    );
    assert_eq!(
        check(
            &g,
            "https://ordinary.test/ad",
            "https://news.test/",
            Type::XmlHttpRequest
        ),
        Decision::Block
    );
    assert_eq!(
        check(&g, "https://all.test/ad", "https://news.test/", Type::Popup),
        Decision::Block
    );
    assert_eq!(
        check(
            &g,
            "https://all.test/ad",
            "https://news.test/",
            Type::Document
        ),
        Decision::Allow
    );
}

#[test]
fn popunder_uses_its_own_rule_set_and_survives_cache_loading() {
    let rules = lists(
        "||ads.test^$popunder,domain=desired.test\n||popup.test^$popup\n||disabled.test^$popup\n||disabled.test^$popup,badfilter",
        0,
    );
    let g = Generation::build(&rules, "[]").unwrap();
    let g = Generation::load(&rules, "[]", &g.serialize()).unwrap();
    assert_eq!(
        check(
            &g,
            "https://ads.test/redirect",
            "https://desired.test/",
            Type::Popunder
        ),
        Decision::Block
    );
    assert_eq!(
        check(
            &g,
            "https://ads.test/redirect",
            "https://desired.test/",
            Type::Popup
        ),
        Decision::Allow
    );
    assert_eq!(
        check(
            &g,
            "https://popup.test/open",
            "https://desired.test/",
            Type::Popup
        ),
        Decision::Block
    );
    assert_eq!(
        check(
            &g,
            "https://disabled.test/open",
            "https://desired.test/",
            Type::Popup
        ),
        Decision::Allow
    );
}

#[test]
fn identity_cache_loads_without_list_text_and_detects_corruption() {
    let rules = lists("||ads.test^", 0);
    let identity = [7u8; 32];
    let original = Generation::build_with_identity(&rules, "[]", identity).unwrap();
    let cache = original.serialize();
    let loaded = Generation::load_with_identity(identity, "[]", &cache).unwrap();
    assert_eq!(
        check(
            &loaded,
            "https://ads.test/a",
            "https://news.test/",
            Type::Image
        ),
        Decision::Block
    );
    assert!(Generation::load_with_identity([8u8; 32], "[]", &cache).is_err());
    // Any single-bit change in the engine payload is rejected.
    for at in [cache.len() / 2, cache.len() - 9, cache.len() - 1] {
        let mut corrupt = cache.clone();
        corrupt[at] ^= 0x10;
        assert!(Generation::load_with_identity(identity, "[]", &corrupt).is_err());
    }
}
