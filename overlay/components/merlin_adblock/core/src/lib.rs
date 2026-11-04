//! Brave's engine, confined to its owner's sequence. No page URLs are retained.
//! Resources are supplied by the application, never by downloaded filter lists.

mod popup;

use adblock::filters::cosmetic::{CosmeticFilterMask, CosmeticFilterOperator};
use adblock::lists::{FilterSet, ParseOptions, ParsedLine, parse_filter};
use adblock::resources::{
    InMemoryResourceStorage, PermissionMask, Resource, ResourceImpl, ResourceStorageBackend,
};
use adblock::{Engine, request::Request};
use base64::{Engine as _, prelude::BASE64_STANDARD};
use sha2::{Digest, Sha256};
use std::cell::Cell;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::rc::Rc;

pub const ENGINE_VERSION: &str = "0.13.3";
pub const MAX_LIST_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_GENERATION_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_RESOURCE_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_URL_BYTES: usize = 64 * 1024;
pub const MAX_TOKENS: usize = 1024;
const CACHE_MAGIC: &[u8] = b"MERLIN-ADBLOCK-4\n0.13.3/css-validation/popup-adapter-1\n";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum ResourceType {
    Other,
    Document,
    Subdocument,
    Script,
    Stylesheet,
    Image,
    Font,
    Media,
    Object,
    XmlHttpRequest,
    Ping,
    WebSocket,
    Popup,
    Popunder,
}

impl TryFrom<u8> for ResourceType {
    type Error = String;
    fn try_from(value: u8) -> Result<Self, Self::Error> {
        Ok(match value {
            0 => Self::Other,
            1 => Self::Document,
            2 => Self::Subdocument,
            3 => Self::Script,
            4 => Self::Stylesheet,
            5 => Self::Image,
            6 => Self::Font,
            7 => Self::Media,
            8 => Self::Object,
            9 => Self::XmlHttpRequest,
            10 => Self::Ping,
            11 => Self::WebSocket,
            12 => Self::Popup,
            13 => Self::Popunder,
            _ => return Err("invalid request type".into()),
        })
    }
}

impl ResourceType {
    fn engine_name(self) -> &'static str {
        match self {
            Self::Other => "other",
            Self::Document => "document",
            Self::Subdocument => "subdocument",
            Self::Script => "script",
            Self::Stylesheet => "stylesheet",
            Self::Image => "image",
            Self::Font => "font",
            Self::Media => "media",
            Self::Object => "object",
            Self::XmlHttpRequest => "xmlhttprequest",
            Self::Ping => "ping",
            Self::WebSocket => "websocket",
            Self::Popup | Self::Popunder => "document",
        }
    }
}

#[derive(Debug, Default, PartialEq, Eq)]
pub enum Decision {
    #[default]
    Allow,
    Block,
    Replace {
        mime: String,
        body: Vec<u8>,
    },
    Rewrite(String),
}

#[derive(Debug, Default)]
pub struct CosmeticData {
    pub hide_selectors: Vec<String>,
    pub procedural_actions: Vec<String>,
    pub exceptions: Vec<String>,
    pub script: String,
    pub isolated_script: String,
    pub generichide: bool,
}

#[derive(Debug, Default, Clone)]
pub struct ListAudit {
    pub rules: usize,
    pub unsupported: usize,
    pub unsupported_reasons: BTreeMap<String, usize>,
    pub csp: usize,
    pub popup: usize,
}

/// Must be constructed, queried and destroyed on one sequence. In particular,
/// this deliberately retains Brave's default `single-thread` configuration.
pub struct Generation {
    engine: Engine,
    popup_engine: Engine,
    popunder_engine: Engine,
    identity: [u8; 32],
    resource_world: Rc<Cell<u8>>,
    pub audit: ListAudit,
}

impl std::fmt::Debug for Generation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Generation")
            .field("identity", &self.identity)
            .field("audit", &self.audit)
            .finish_non_exhaustive()
    }
}

/// A source's permissions come from Merlin's fixed source catalog, never its text.
#[derive(Debug, Clone)]
pub struct List {
    pub id: String,
    pub text: String,
    pub permissions: u8,
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

pub fn digest_hex(bytes: &[u8]) -> String {
    sha256(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// Detects accidental corruption of the serialized engine without hashing the
/// whole payload with SHA-256 on every startup. The embedder already verifies a
/// SHA-256 digest of the complete cache file (with hardware acceleration), and
/// the FlatBuffers verifier rejects structurally invalid engine data. Four
/// independent multiply-rotate lanes keep this at memory bandwidth; every lane
/// step is a bijection, so any change confined to one 8-byte word is detected.
fn checksum(bytes: &[u8]) -> [u8; 32] {
    const K: [u64; 4] = [
        0x9E37_79B9_7F4A_7C15,
        0xC2B2_AE3D_27D4_EB4F,
        0x1656_67B1_9E37_79F9,
        0x85EB_CA77_C2B2_AE63,
    ];
    let mut lanes = [
        0x243F_6A88_85A3_08D3u64,
        0x1319_8A2E_0370_7344,
        0xA409_3822_299F_31D0,
        0x082E_FA98_EC4E_6C89,
    ];
    let mut step = |chunk: &[u8]| {
        for (i, lane) in lanes.iter_mut().enumerate() {
            let word = u64::from_le_bytes(chunk[i * 8..i * 8 + 8].try_into().unwrap());
            *lane = (*lane ^ word).wrapping_mul(K[i]).rotate_left(29);
        }
    };
    let (chunks, tail) = bytes.as_chunks::<32>();
    chunks.iter().for_each(|chunk| step(chunk));
    let mut last = [0u8; 32];
    last[..tail.len()].copy_from_slice(tail);
    step(&last);
    let mut out = [0u8; 32];
    for (i, lane) in lanes.iter().enumerate() {
        // Murmur3 finalizer, with the length mixed in to separate truncations.
        let mut h = lane ^ (bytes.len() as u64).wrapping_mul(K[(i + 1) % 4]);
        h ^= h >> 33;
        h = h.wrapping_mul(0xFF51_AFD7_ED55_8CCD);
        h ^= h >> 33;
        h = h.wrapping_mul(0xC4CE_B9FE_1A85_EC53);
        h ^= h >> 33;
        out[i * 8..i * 8 + 8].copy_from_slice(&h.to_le_bytes());
    }
    out
}

/// Text-based identity for standalone use. The browser computes a cheaper
/// identity from catalog metadata and source digests and passes it in with
/// `build_with_identity`/`load_with_identity`, so startup never rehashes lists.
pub fn identity(lists: &[List], resources: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(CACHE_MAGIC);
    // Length delimiters prevent ambiguity between adjacent source fields.
    for list in lists {
        for field in [list.id.as_bytes(), list.text.as_bytes()] {
            hasher.update((field.len() as u64).to_le_bytes());
            hasher.update(field);
        }
        hasher.update([list.permissions]);
    }
    hasher.update(sha256(resources.as_bytes()));
    hasher.update(b"web-only;no-strict-documents;policy-1");
    hasher.finalize().into()
}

fn validated_resources(json: &str) -> Result<Vec<Resource>, String> {
    if json.len() > MAX_RESOURCE_BYTES {
        return Err("resource bundle exceeds size limit".into());
    }
    let resources: Vec<Resource> =
        serde_json::from_str(json).map_err(|_| "invalid resource bundle".to_string())?;
    let mut names = HashSet::new();
    let mut storage = InMemoryResourceStorage::default();
    for r in &resources {
        if r.name.is_empty() || r.name.len() > 256 || r.permission.to_bits() & !3 != 0 {
            return Err("invalid resource metadata".into());
        }
        for name in std::iter::once(&r.name).chain(r.aliases.iter()) {
            if !names.insert(name.clone()) {
                return Err("duplicate resource or alias".into());
            }
        }
        storage
            .add_resource(r.clone())
            .map_err(|_| "invalid resource content".to_string())?;
    }
    // Reject missing dependencies and cycles before handing the bundle to Brave.
    fn visit<'a>(
        name: &'a str,
        resources: &'a [Resource],
        path: &mut HashSet<&'a str>,
        done: &mut HashSet<&'a str>,
    ) -> Result<(), String> {
        if done.contains(name) {
            return Ok(());
        }
        if !path.insert(name) {
            return Err("cyclic resource dependency".into());
        }
        let r = resources
            .iter()
            .find(|r| r.name == name)
            .ok_or("missing resource dependency")?;
        for dependency in &r.dependencies {
            visit(dependency, resources, path, done)?;
        }
        path.remove(name);
        done.insert(name);
        Ok(())
    }
    let mut done = HashSet::new();
    for r in &resources {
        visit(&r.name, &resources, &mut HashSet::new(), &mut done)?;
    }
    Ok(resources)
}

struct WorldResources {
    storage: InMemoryResourceStorage,
    worlds: HashMap<String, u8>,
    current: Rc<Cell<u8>>,
}
impl ResourceStorageBackend for WorldResources {
    fn get_resource(&self, name: &str) -> Option<ResourceImpl> {
        let world = self.worlds.get(name).copied().unwrap_or(0);
        if self.current.get() != 0 && world != 0 && world != self.current.get() {
            return None;
        }
        self.storage.get_resource(name)
    }
}
fn install_resources(
    engine: &mut Engine,
    resources: Vec<Resource>,
    json: &str,
) -> Result<Rc<Cell<u8>>, String> {
    let metadata: serde_json::Value =
        serde_json::from_str(json).map_err(|_| "invalid resource metadata")?;
    let mut worlds = HashMap::new();
    for resource in metadata.as_array().ok_or("invalid resource metadata")? {
        let name = resource["name"].as_str().ok_or("missing resource name")?;
        let world = match resource
            .get("world")
            .and_then(|w| w.as_str())
            .unwrap_or("MAIN")
        {
            "MAIN" => 1,
            "ISOLATED" => 2,
            _ => return Err("unknown resource execution world".into()),
        };
        // Function dependencies are inert declarations, shared by both worlds.
        let world = if name.ends_with(".fn") { 0 } else { world };
        worlds.insert(name.to_string(), world);
        if let Some(aliases) = resource["aliases"].as_array() {
            for alias in aliases {
                worlds.insert(alias.as_str().ok_or("invalid alias")?.to_string(), world);
            }
        }
    }
    let current = Rc::new(Cell::new(0));
    engine.use_resource_storage(WorldResources {
        storage: InMemoryResourceStorage::from_resources(resources),
        worlds,
        current: current.clone(),
    });
    Ok(current)
}

// Evaluate list conditionals for this native Chromium embedder. Unknown
// capabilities reject an update rather than enabling both branches silently.
fn preprocess(text: &str, lists: &[List], permissions: u8, depth: usize) -> Result<String, String> {
    if depth > 16 {
        return Err("cyclic or deeply nested list includes".into());
    }
    let mut stack: Vec<(bool, bool)> = Vec::new();
    let mut active = true;
    let mut result = String::new();
    for raw in text.lines() {
        let line = raw.trim();
        if let Some(expression) = line.strip_prefix("!#if ") {
            if stack.len() >= 16 {
                return Err("list conditional nesting exceeds limit".into());
            }
            let (negate, token) = expression
                .strip_prefix('!')
                .map(|v| (true, v))
                .unwrap_or((false, expression));
            let value = match token {
                "env_chromium" => true,
                "env_firefox" | "env_safari" | "env_mobile" | "env_mv3" | "ext_ubol"
                | "cap_html_filtering" | "cap_ipaddress" => false,
                _ => return Err("unknown list conditional".into()),
            } ^ negate;
            stack.push((active, value));
            active &= value;
        } else if line == "!#else" {
            let (parent, value) = stack.last_mut().ok_or("unmatched list else")?;
            *value = !*value;
            active = *parent && *value;
        } else if line == "!#endif" {
            active = stack.pop().ok_or("unmatched list endif")?.0;
        } else if let Some(file) = line.strip_prefix("!#include ") {
            // The catalog contains the closed set of source files. Runtime
            // lists cannot select arbitrary URLs or add new sources.
            if active {
                let included = lists
                    .iter()
                    .find(|l| l.id.rsplit('/').next() == Some(file))
                    .ok_or("list references a source absent from the approved catalog")?;
                if included.permissions != permissions {
                    return Err("include crosses list trust boundary".into());
                }
                result.push_str(&preprocess(&included.text, lists, permissions, depth + 1)?);
                if result.len() > MAX_LIST_BYTES {
                    return Err("expanded list exceeds size limit".into());
                }
            }
        } else if active {
            result.push_str(raw);
            result.push('\n');
        }
    }
    if !stack.is_empty() {
        return Err("unterminated list conditional".into());
    }
    Ok(result)
}

impl Generation {
    pub fn build(lists: &[List], resources_json: &str) -> Result<Self, String> {
        Self::build_with_identity(lists, resources_json, identity(lists, resources_json))
    }

    /// `identity` must change whenever the lists, their permissions, the
    /// resources or this engine configuration change.
    pub fn build_with_identity(
        lists: &[List],
        resources_json: &str,
        identity: [u8; 32],
    ) -> Result<Self, String> {
        if lists.is_empty()
            || lists.len() > 64
            || lists.iter().map(|l| l.text.len()).sum::<usize>() > MAX_GENERATION_BYTES
        {
            return Err("invalid list set size".into());
        }
        let resources = validated_resources(resources_json)?;
        let resource_names: HashSet<_> = resources
            .iter()
            .flat_map(|r| {
                std::iter::once(r.name.as_str()).chain(r.aliases.iter().map(String::as_str))
            })
            .collect();
        let mut set = FilterSet::new(false);
        let mut popup_set = FilterSet::new(false);
        let mut popunder_set = FilterSet::new(false);
        let mut audit = ListAudit::default();
        let mut ids = HashSet::new();
        let included: HashSet<_> = lists
            .iter()
            .flat_map(|l| l.text.lines())
            .filter_map(|line| line.trim().strip_prefix("!#include "))
            .collect();
        for list in lists {
            if list.text.len() > MAX_LIST_BYTES
                || list.permissions & !3 != 0
                || !ids.insert(&list.id)
            {
                return Err("invalid source size, permissions or identity".into());
            }
            if included.contains(list.id.rsplit('/').next().unwrap_or_default()) {
                continue;
            }
            let options = ParseOptions {
                permissions: PermissionMask::from_bits(list.permissions),
                ..ParseOptions::default()
            };
            let text = preprocess(&list.text, lists, list.permissions, 0)?;
            let mut network_rules = String::new();
            let mut popup_rules = String::new();
            let mut popunder_rules = String::new();
            // Keep an explicit audit of syntax the pinned engine does not understand.
            for raw in text.lines() {
                let line = raw.trim();
                if line.is_empty() || line.starts_with('!') || line.starts_with('[') {
                    continue;
                }
                let adapted = popup::adapt(line);
                let mut supported = false;
                let mut failure = None;
                for (candidate, destination) in [
                    (adapted.network.as_deref(), &mut network_rules),
                    (adapted.popup.as_deref(), &mut popup_rules),
                    (adapted.popunder.as_deref(), &mut popunder_rules),
                ] {
                    let Some(candidate) = candidate else { continue };
                    destination.push_str(candidate);
                    destination.push('\n');
                    match parse_filter(candidate, false, options) {
                        Ok(ParsedLine::Network(filter)) => {
                            if filter.is_redirect()
                                && let Some(name) = filter.modifier_option
                            {
                                let name = name
                                    .rsplit_once(':')
                                    .filter(|(_, priority)| priority.parse::<i32>().is_ok())
                                    .map(|(name, _)| name)
                                    .unwrap_or(name);
                                if name != "none" && !resource_names.contains(name) {
                                    return Err(
                                        "list references an unavailable replacement resource"
                                            .into(),
                                    );
                                }
                            }
                            supported = true;
                        }
                        Ok(ParsedLine::Cosmetic(filter)) => {
                            if filter.mask.contains(CosmeticFilterMask::SCRIPT_INJECT)
                                && let Some(CosmeticFilterOperator::CssSelector(args)) =
                                    filter.selector.first()
                            {
                                let name = args
                                    .split(',')
                                    .next()
                                    .unwrap_or_default()
                                    .trim()
                                    .trim_matches(['\'', '"']);
                                if !name.is_empty() {
                                    let name = if name.ends_with(".js") {
                                        name.to_string()
                                    } else {
                                        format!("{name}.js")
                                    };
                                    if !resource_names.contains(name.as_str()) {
                                        return Err(
                                            "list references an unavailable scriptlet resource"
                                                .into(),
                                        );
                                    }
                                }
                            }
                            supported = true;
                        }
                        Err(error) => failure = Some(error.to_string()),
                    }
                }
                if supported {
                    audit.rules += 1;
                } else {
                    audit.unsupported += 1;
                    *audit
                        .unsupported_reasons
                        .entry(failure.unwrap_or_else(|| "unsupported window rule".into()))
                        .or_default() += 1;
                }
                if line.contains("$csp=") || line.contains(",csp=") {
                    audit.csp += 1;
                }
                if line.contains("$popup") || line.contains(",popup") || line.contains("$popunder")
                {
                    audit.popup += 1;
                }
            }
            set.add_filter_list(network_rules, options);
            popup_set.add_filter_list(popup_rules, options);
            popunder_set.add_filter_list(popunder_rules, options);
        }
        if audit.rules == 0 {
            return Err("no supported rules in generation".into());
        }
        let mut engine = Engine::new_with_filter_set(set);
        let resource_world = install_resources(&mut engine, resources, resources_json)?;
        Ok(Self {
            engine,
            popup_engine: Engine::new_with_filter_set(popup_set),
            popunder_engine: Engine::new_with_filter_set(popunder_set),
            identity,
            audit,
            resource_world,
        })
    }

    pub fn check(
        &self,
        url: &str,
        source: &str,
        method: &str,
        kind: ResourceType,
    ) -> Result<Decision, String> {
        if url.len() > MAX_URL_BYTES
            || source.len() > MAX_URL_BYTES
            || method.len() > 32
            || method.is_empty()
            || !method.bytes().all(|b| b.is_ascii_alphabetic() || b == b'-')
        {
            return Err("invalid request input".into());
        }
        // Strict top-level document blocking has no recovery interstitial yet.
        if kind == ResourceType::Document {
            return Ok(Decision::Allow);
        }
        if !(url.starts_with("http://")
            || url.starts_with("https://")
            || url.starts_with("ws://")
            || url.starts_with("wss://"))
        {
            return Ok(Decision::Allow);
        }
        let request = Request::new(url, source, kind.engine_name(), method)
            .map_err(|_| "invalid request URL or source".to_string())?;
        self.resource_world.set(0);
        if matches!(kind, ResourceType::Popup | ResourceType::Popunder) {
            let engine = if kind == ResourceType::Popup {
                &self.popup_engine
            } else {
                &self.popunder_engine
            };
            return Ok(if engine.check_network_request(&request).should_block() {
                Decision::Block
            } else {
                Decision::Allow
            });
        }
        let result = self.engine.check_network_request(&request);
        if result.should_block() {
            if let Some(resource) = result.redirect {
                let (meta, encoded) = resource
                    .strip_prefix("data:")
                    .and_then(|v| v.split_once(','))
                    .ok_or("invalid replacement")?;
                let mime = meta
                    .strip_suffix(";base64")
                    .ok_or("non-base64 replacement")?;
                let body = BASE64_STANDARD
                    .decode(encoded)
                    .map_err(|_| "invalid replacement encoding")?;
                if body.len() > MAX_RESOURCE_BYTES || mime.contains(['\r', '\n']) {
                    return Err("invalid replacement size or MIME".into());
                }
                return Ok(Decision::Replace {
                    mime: mime.into(),
                    body,
                });
            }
            return Ok(Decision::Block);
        }
        if let Some(rewritten) = result.rewritten_url {
            return Ok(Decision::Rewrite(rewritten));
        }
        Ok(Decision::Allow)
    }

    pub fn csp(&self, url: &str, source: &str) -> Result<String, String> {
        self.csp_for_request(url, source, false)
    }

    pub fn csp_for_request(
        &self,
        url: &str,
        source: &str,
        main_document: bool,
    ) -> Result<String, String> {
        let req = Request::new(
            url,
            source,
            if main_document {
                "document"
            } else {
                "subdocument"
            },
            "GET",
        )
        .map_err(|_| "invalid CSP URL")?;
        Ok(self.engine.get_csp_directives(&req).unwrap_or_default())
    }

    pub fn cosmetics(&self, url: &str) -> CosmeticData {
        if url.len() > MAX_URL_BYTES || !(url.starts_with("https://") || url.starts_with("http://"))
        {
            return CosmeticData::default();
        }
        self.resource_world.set(1);
        let data = self.engine.url_cosmetic_resources(url);
        self.resource_world.set(2);
        let isolated_script = self.engine.url_cosmetic_resources(url).injected_script;
        self.resource_world.set(0);
        let mut hide_selectors: Vec<_> = data.hide_selectors.into_iter().collect();
        hide_selectors.sort();
        let mut procedural_actions: Vec<_> = data.procedural_actions.into_iter().collect();
        procedural_actions.sort();
        CosmeticData {
            hide_selectors,
            procedural_actions,
            exceptions: data.exceptions.into_iter().collect(),
            script: data.injected_script,
            isolated_script,
            generichide: data.generichide,
        }
    }

    pub fn generic_selectors(
        &self,
        classes: &[String],
        ids: &[String],
        exceptions: &[String],
    ) -> Result<Vec<String>, String> {
        if classes.len() + ids.len() > MAX_TOKENS
            || exceptions.len() > 4096
            || classes
                .iter()
                .chain(ids)
                .chain(exceptions)
                .any(|v| v.len() > 1024)
        {
            return Err("cosmetic query exceeds limits".into());
        }
        Ok(self.engine.hidden_class_id_selectors(
            classes,
            ids,
            &exceptions.iter().cloned().collect(),
        ))
    }

    pub fn serialize(&self) -> Vec<u8> {
        let network = self.engine.serialize();
        let popup = self.popup_engine.serialize();
        let popunder = self.popunder_engine.serialize();
        let mut payload = Vec::with_capacity(16 + network.len() + popup.len() + popunder.len());
        payload.extend_from_slice(&(network.len() as u64).to_le_bytes());
        payload.extend_from_slice(&(popup.len() as u64).to_le_bytes());
        payload.extend(network);
        payload.extend(popup);
        payload.extend(popunder);
        let mut data = Vec::with_capacity(CACHE_MAGIC.len() + 64 + payload.len());
        data.extend_from_slice(CACHE_MAGIC);
        data.extend_from_slice(&self.identity);
        data.extend_from_slice(&checksum(&payload));
        data.extend(payload);
        data
    }

    pub fn load(lists: &[List], resources: &str, data: &[u8]) -> Result<Self, String> {
        Self::load_with_identity(identity(lists, resources), resources, data)
    }

    /// Loads a serialized generation without the source text. The caller's
    /// identity must equal the one the generation was built with.
    pub fn load_with_identity(
        identity: [u8; 32],
        resources: &str,
        data: &[u8],
    ) -> Result<Self, String> {
        let offset = CACHE_MAGIC.len();
        if data.len() < offset + 64
            || data.len() > MAX_GENERATION_BYTES
            || !data.starts_with(CACHE_MAGIC)
            || data[offset..offset + 32] != identity
            || data[offset + 32..offset + 64] != checksum(&data[offset + 64..])
        {
            return Err("incompatible or corrupt engine cache".into());
        }
        let approved = validated_resources(resources)?;
        let payload = &data[offset + 64..];
        if payload.len() < 16 {
            return Err("invalid engine cache lengths".into());
        }
        let network_len = usize::try_from(u64::from_le_bytes(payload[..8].try_into().unwrap()))
            .map_err(|_| "invalid cache length")?;
        let popup_len = usize::try_from(u64::from_le_bytes(payload[8..16].try_into().unwrap()))
            .map_err(|_| "invalid cache length")?;
        let split = 16usize
            .checked_add(network_len)
            .ok_or("invalid cache length")?;
        let end = split.checked_add(popup_len).ok_or("invalid cache length")?;
        if end > payload.len() {
            return Err("invalid engine cache lengths".into());
        }
        let mut engine = Engine::default();
        let mut popup_engine = Engine::default();
        let mut popunder_engine = Engine::default();
        engine
            .deserialize(&payload[16..split])
            .map_err(|_| "invalid serialized engine")?;
        popup_engine
            .deserialize(&payload[split..end])
            .map_err(|_| "invalid serialized popup engine")?;
        popunder_engine
            .deserialize(&payload[end..])
            .map_err(|_| "invalid serialized popunder engine")?;
        let resource_world = install_resources(&mut engine, approved, resources)?;
        Ok(Self {
            engine,
            popup_engine,
            popunder_engine,
            identity,
            audit: ListAudit::default(),
            resource_world,
        })
    }
}
