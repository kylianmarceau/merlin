//! Dedicated bridge, independent of modal browsing. C++ owns sequence affinity.
#[cfg(feature = "chromium_gn")]
chromium::import! {
    "//components/merlin_adblock/core:merlin_adblock_core";
}

use merlin_adblock_core as core;

#[cxx::bridge(namespace = "merlin_adblock::ffi")]
mod ffi {
    #[derive(Debug)]
    struct ListSource {
        id: String,
        text: String,
        permissions: u8,
    }
    #[derive(Debug)]
    enum DecisionKind {
        Allow,
        Block,
        Replace,
        Rewrite,
        Error,
    }
    #[derive(Debug)]
    struct Decision {
        kind: DecisionKind,
        mime: String,
        body: Vec<u8>,
        rewritten_url: String,
    }
    #[derive(Debug)]
    struct CosmeticData {
        selectors: Vec<String>,
        procedural: Vec<String>,
        exceptions: Vec<String>,
        script: String,
        isolated_script: String,
        generichide: bool,
    }
    extern "Rust" {
        type Generation;
        fn build_generation(
            lists: Vec<ListSource>,
            resources: &str,
            identity: &[u8],
        ) -> Box<Generation>;
        // No list text: startup only needs the serialized engine and resources.
        fn load_generation(identity: &[u8], resources: &str, bytes: &[u8]) -> Box<Generation>;
        fn valid(self: &Generation) -> bool;
        fn error(self: &Generation) -> &str;
        fn serialize(self: &Generation) -> Vec<u8>;
        fn check(self: &Generation, url: &str, source: &str, method: &str, kind: u8) -> Decision;
        fn cosmetics(self: &Generation, url: &str) -> CosmeticData;
        fn generic_selectors(
            self: &Generation,
            classes: Vec<String>,
            ids: Vec<String>,
            exceptions: Vec<String>,
        ) -> Vec<String>;
        fn csp(self: &Generation, url: &str, source: &str, main_document: bool) -> String;
        fn rule_count(self: &Generation) -> usize;
        fn unsupported_count(self: &Generation) -> usize;
    }
}

pub struct Generation {
    inner: Option<core::Generation>,
    error: String,
}

fn sources(lists: Vec<ffi::ListSource>) -> Vec<core::List> {
    lists
        .into_iter()
        .map(|l| core::List {
            id: l.id,
            text: l.text,
            permissions: l.permissions,
        })
        .collect()
}
fn wrap(result: Result<core::Generation, String>) -> Box<Generation> {
    match result {
        Ok(inner) => Box::new(Generation {
            inner: Some(inner),
            error: String::new(),
        }),
        Err(error) => Box::new(Generation { inner: None, error }),
    }
}
fn identity(bytes: &[u8]) -> Result<[u8; 32], String> {
    bytes
        .try_into()
        .map_err(|_| "invalid generation identity".to_string())
}
fn build_generation(
    lists: Vec<ffi::ListSource>,
    resources: &str,
    identity_bytes: &[u8],
) -> Box<Generation> {
    wrap(identity(identity_bytes).and_then(|identity| {
        core::Generation::build_with_identity(&sources(lists), resources, identity)
    }))
}
fn load_generation(identity_bytes: &[u8], resources: &str, bytes: &[u8]) -> Box<Generation> {
    wrap(
        identity(identity_bytes)
            .and_then(|identity| core::Generation::load_with_identity(identity, resources, bytes)),
    )
}
impl Generation {
    fn valid(&self) -> bool {
        self.inner.is_some()
    }
    fn error(&self) -> &str {
        &self.error
    }
    fn serialize(&self) -> Vec<u8> {
        self.inner
            .as_ref()
            .map(core::Generation::serialize)
            .unwrap_or_default()
    }
    fn rule_count(&self) -> usize {
        self.inner
            .as_ref()
            .map(|g| g.audit.rules)
            .unwrap_or_default()
    }
    fn unsupported_count(&self) -> usize {
        self.inner
            .as_ref()
            .map(|g| g.audit.unsupported)
            .unwrap_or_default()
    }
    fn check(&self, url: &str, source: &str, method: &str, kind: u8) -> ffi::Decision {
        let result = self
            .inner
            .as_ref()
            .ok_or_else(|| "no engine".to_string())
            .and_then(|g| g.check(url, source, method, kind.try_into()?));
        let mut decision = ffi::Decision {
            kind: ffi::DecisionKind::Allow,
            mime: String::new(),
            body: Vec::new(),
            rewritten_url: String::new(),
        };
        match result {
            Ok(core::Decision::Allow) => {}
            Ok(core::Decision::Block) => decision.kind = ffi::DecisionKind::Block,
            Ok(core::Decision::Replace { mime, body }) => {
                decision.kind = ffi::DecisionKind::Replace;
                decision.mime = mime;
                decision.body = body;
            }
            Ok(core::Decision::Rewrite(url)) => {
                decision.kind = ffi::DecisionKind::Rewrite;
                decision.rewritten_url = url;
            }
            Err(_) => decision.kind = ffi::DecisionKind::Error,
        }
        decision
    }
    fn cosmetics(&self, url: &str) -> ffi::CosmeticData {
        let data = self
            .inner
            .as_ref()
            .map(|g| g.cosmetics(url))
            .unwrap_or_default();
        ffi::CosmeticData {
            selectors: data.hide_selectors,
            procedural: data.procedural_actions,
            exceptions: data.exceptions,
            script: data.script,
            isolated_script: data.isolated_script,
            generichide: data.generichide,
        }
    }
    fn generic_selectors(
        &self,
        classes: Vec<String>,
        ids: Vec<String>,
        exceptions: Vec<String>,
    ) -> Vec<String> {
        self.inner
            .as_ref()
            .and_then(|g| g.generic_selectors(&classes, &ids, &exceptions).ok())
            .unwrap_or_default()
    }
    fn csp(&self, url: &str, source: &str, main_document: bool) -> String {
        self.inner
            .as_ref()
            .and_then(|g| g.csp_for_request(url, source, main_document).ok())
            .unwrap_or_default()
    }
}
