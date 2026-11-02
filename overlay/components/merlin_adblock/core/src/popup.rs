//! Adapt only the missing window-specific resource types. Brave still parses
//! and evaluates patterns, exceptions, domains, party conditions and priorities.
//! The normal network engine must never turn a popup-only rule into a generic
//! subresource blocker. Popunders have a separate engine and reversed context.
#[derive(Default)]
pub(crate) struct Adapted {
    pub network: Option<String>,
    pub popup: Option<String>,
    pub popunder: Option<String>,
}

pub(crate) fn adapt(line: &str) -> Adapted {
    let unchanged = || Adapted {
        network: Some(line.to_owned()),
        ..Adapted::default()
    };
    if line.starts_with('!') || line.contains("##") || line.contains("#@#") {
        return unchanged();
    }
    let Some((pattern, tail)) = line.rsplit_once('$') else {
        return unchanged();
    };
    let options: Vec<_> = tail.split(',').map(str::trim).collect();
    if !options
        .iter()
        .any(|v| matches!(*v, "popup" | "~popup" | "popunder" | "~popunder" | "all"))
    {
        return unchanged();
    }
    let regex = pattern.strip_prefix("@@").unwrap_or(pattern);
    if regex.starts_with('/') && !regex.ends_with('/') {
        return unchanged();
    }
    let popup = options.contains(&"popup") || options.contains(&"all");
    let popunder = options.contains(&"popunder");
    let negative_popup = options.contains(&"~popup");
    let negative_popunder = options.contains(&"~popunder");
    let ordinary_positive = options.iter().any(|v| {
        matches!(
            *v,
            "all"
                | "document"
                | "doc"
                | "subdocument"
                | "frame"
                | "script"
                | "image"
                | "stylesheet"
                | "css"
                | "font"
                | "media"
                | "object"
                | "object-subrequest"
                | "other"
                | "xhr"
                | "xmlhttprequest"
                | "ping"
                | "websocket"
        )
    });
    let rest: Vec<_> = options
        .iter()
        .copied()
        .filter(|v| !matches!(*v, "popup" | "~popup" | "popunder" | "~popunder"))
        .collect();
    let special = || {
        let mut filtered: Vec<_> = rest
            .iter()
            .copied()
            .filter(|v| {
                !matches!(
                    v.trim_start_matches('~'),
                    "all"
                        | "document"
                        | "doc"
                        | "subdocument"
                        | "frame"
                        | "script"
                        | "image"
                        | "stylesheet"
                        | "css"
                        | "font"
                        | "media"
                        | "object"
                        | "object-subrequest"
                        | "other"
                        | "xhr"
                        | "xmlhttprequest"
                        | "ping"
                        | "websocket"
                )
            })
            .collect();
        filtered.push("document");
        format!("{pattern}${}", filtered.join(","))
    };
    Adapted {
        network: if (popup || popunder) && !ordinary_positive {
            None
        } else if rest.is_empty() {
            Some(pattern.to_owned())
        } else {
            Some(format!("{pattern}${}", rest.join(",")))
        },
        popup: (popup && !negative_popup).then(special),
        popunder: (popunder && !negative_popunder).then(special),
    }
}
