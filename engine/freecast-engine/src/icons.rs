//! Insert › Icons: Lucide stroke icons (ISC; Feather-derived icons MIT), as DeckCraft ships them in
//! `icon_data.rs` (Lucide 1.56.0, commit 440a1e1dfb1e712505308da46bead3c28b1f1398). Drawn on a 24×24
//! viewBox, stroked, not filled.

use serde_json::json;

use crate::Res;

/// One icon from the gallery.
pub struct Icon {
    pub name: &'static str,
    pub label: &'static str,
    pub category: &'static str,
    /// Design stroke width in viewBox units.
    pub stroke: f64,
    /// SVG path data; independent sub-paths are separated by ` | `.
    pub d: &'static str,
}

include!("icon_data.rs");

/// `[{name, label, category, stroke, d: [sub-path…]}]`. Sub-paths stay separate: each may start with
/// a relative `m`, which is only absolute at the start of its own path element.
pub fn catalog() -> Res {
    Ok(ICONS
        .iter()
        .map(|i| json!({ "name": i.name, "label": i.label, "category": i.category, "stroke": i.stroke, "d": i.d.split(" | ").collect::<Vec<_>>() }))
        .collect())
}

/// Number of icons (for tests).
pub fn count() -> usize {
    ICONS.len()
}
