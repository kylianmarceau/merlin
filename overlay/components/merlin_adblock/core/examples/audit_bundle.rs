//! Reproducible release-data audit, without a browser or network access.
use merlin_adblock_core::{Generation, List};
use serde_json::json;
use std::collections::BTreeSet;
use std::path::Path;

fn main() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../resources");
    let manifest: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(root.join("manifest.json")).unwrap())
            .unwrap();
    let resources = std::fs::read_to_string(root.join("resources.json")).unwrap();
    let metadata: serde_json::Value = serde_json::from_str(&resources).unwrap();
    let lists: Vec<_> = manifest["sources"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| List {
            id: s["id"].as_str().unwrap().into(),
            text: std::fs::read_to_string(root.join(s["file"].as_str().unwrap())).unwrap(),
            permissions: s["permissions"].as_u64().unwrap() as u8,
        })
        .collect();
    let mut names = BTreeSet::new();
    for r in metadata.as_array().unwrap() {
        names.insert(r["name"].as_str().unwrap().to_string());
        if let Some(aliases) = r["aliases"].as_array() {
            for alias in aliases {
                names.insert(alias.as_str().unwrap().to_string());
            }
        }
    }
    let mut references = BTreeSet::new();
    let mut missing = BTreeSet::new();
    for list in &lists {
        for line in list.text.lines().filter(|line| !line.starts_with('!')) {
            if let Some((_, invocation)) = line.split_once("##+js(") {
                let name = invocation
                    .split([',', ')'])
                    .next()
                    .unwrap_or("")
                    .trim()
                    .trim_matches(['\'', '"']);
                let canonical = if name.ends_with(".js") {
                    name.to_string()
                } else {
                    format!("{name}.js")
                };
                if !name.is_empty() {
                    references.insert(canonical.clone());
                    if !names.contains(&canonical) {
                        missing.insert(canonical);
                    }
                }
            }
        }
    }
    let start = std::time::Instant::now();
    let engine = Generation::build(&lists, &resources).unwrap();
    let build_ms = start.elapsed().as_millis();
    let youtube = engine.cosmetics("https://www.youtube.com/watch?v=local-audit");
    let clean = engine.cosmetics("http://page.fixture.test/clean");
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "engine": merlin_adblock_core::ENGINE_VERSION,
            "sources": lists.len(),
            "supported_rules": engine.audit.rules,
            "unsupported_rules": engine.audit.unsupported,
            "unsupported_reasons": engine.audit.unsupported_reasons,
            "csp_rules": engine.audit.csp,
            "popup_rules": engine.audit.popup,
            "resource_count": metadata.as_array().unwrap().len(),
            "scriptlet_names_in_raw_sources": references.len(),
            "missing_scriptlets_including_inactive_branches": missing,
            "serialized_cache_bytes": engine.serialize().len(),
            "build_ms": build_ms,
            "youtube_main_script_bytes": youtube.script.len(),
            "youtube_isolated_script_bytes": youtube.isolated_script.len(),
            "youtube_specific_selectors": youtube.hide_selectors.len(),
            "youtube_procedural_rules": youtube.procedural_actions.len(),
            "clean_main_script_bytes": clean.script.len(),
            "clean_isolated_script_bytes": clean.isolated_script.len(),
            "clean_specific_selectors": clean.hide_selectors.len(),
            "clean_procedural_rules": clean.procedural_actions.len(),
            "clean_generic_filtering_enabled": !clean.generichide,
        }))
        .unwrap()
    );
}
