//! Colours: DeckCraft's colour schemes (Design › Variants › Colors), the colour picker's theme grid
//! (each theme colour with its lighter / darker shades), the standard colours, shape Quick Styles,
//! and the WCAG contrast ratio the accessibility check uses.

use deckcraft_color::{ColorScheme, ColorTransform, Rgba, STANDARD_COLORS, SchemeSlot, apply, theme_variants};
use deckcraft_model::theme::builtin_color_schemes;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::Res;

pub fn hex(c: Rgba) -> String {
    format!("#{}", c.hex())
}

/// The scheme named `name` (case-insensitive), else the first built-in one.
pub fn scheme_named(name: Option<&str>) -> ColorScheme {
    // Design › Browse for Themes: a scheme read from a theme file travels as
    // `custom:<name>|<dk1>,<lt1>,<dk2>,<lt2>,<accent1…6>,<hlink>,<folHlink>`.
    if let Some(spec) = name.and_then(|n| n.strip_prefix("custom:")) {
        let (label, list) = spec.split_once('|').unwrap_or(("Custom", spec));
        let cols: Vec<Rgba> = list.split(',').filter_map(|h| Rgba::from_hex(h.trim())).collect();
        if cols.len() == 12 {
            let mut colors = [Rgba::BLACK; 12];
            colors.copy_from_slice(&cols);
            return ColorScheme { name: label.into(), colors };
        }
    }
    let all = builtin_color_schemes();
    let pick = name.and_then(|n| all.iter().find(|s| s.name.eq_ignore_ascii_case(n)).cloned());
    match pick {
        Some(s) => s,
        None => all.into_iter().next().unwrap_or(ColorScheme { name: "Default".into(), colors: [Rgba::BLACK; 12] }),
    }
}

/// `[{name, colors: [dk1, lt1, dk2, lt2, accent1…6, hlink, folHlink]}]`.
pub fn schemes() -> Res {
    Ok(builtin_color_schemes().iter().map(|s| json!({ "name": s.name, "colors": s.colors.iter().map(|c| hex(*c)).collect::<Vec<_>>() })).collect())
}

#[derive(Deserialize)]
pub struct PaletteReq {
    #[serde(default)]
    pub scheme: Option<String>,
}

/// The colour picker: ten theme colours in PowerPoint's order (Background 1, Text 1, Background 2,
/// Text 2, Accent 1–6), each with five shades, and the ten standard colours.
pub fn palette(r: PaletteReq) -> Res {
    let s = scheme_named(r.scheme.as_deref());
    let order = [
        (SchemeSlot::Lt1, "bg1"),
        (SchemeSlot::Dk1, "tx1"),
        (SchemeSlot::Lt2, "bg2"),
        (SchemeSlot::Dk2, "tx2"),
        (SchemeSlot::Accent1, "accent1"),
        (SchemeSlot::Accent2, "accent2"),
        (SchemeSlot::Accent3, "accent3"),
        (SchemeSlot::Accent4, "accent4"),
        (SchemeSlot::Accent5, "accent5"),
        (SchemeSlot::Accent6, "accent6"),
    ];
    let theme: Vec<Value> = order
        .iter()
        .map(|(slot, id)| {
            let c = s.get(*slot);
            let shades: Vec<Value> = theme_variants(c).iter().map(|(t, label)| json!({ "hex": hex(apply(c, t)), "label": label })).collect();
            json!({ "slot": id, "hex": hex(c), "shades": shades })
        })
        .collect();
    let standard: Vec<Value> = STANDARD_COLORS.iter().map(|(c, l)| json!({ "hex": hex(*c), "label": l })).collect();
    Ok(json!({ "scheme": s.name, "theme": theme, "standard": standard }))
}

#[derive(Deserialize)]
pub struct ContrastReq {
    pub fg: String,
    pub bg: String,
}

/// WCAG contrast ratio of two `#rrggbb` colours (1–21).
pub fn contrast(r: ContrastReq) -> Res {
    let fg = Rgba::from_hex(&r.fg).ok_or("bad fg colour")?;
    let bg = Rgba::from_hex(&r.bg).ok_or("bad bg colour")?;
    let ratio = fg.contrast(bg);
    Ok(json!({ "ratio": (ratio * 100.0).round() / 100.0, "aa": ratio >= 4.5, "aaLarge": ratio >= 3.0 }))
}

/// Shape › Quick Styles: six theme styles (rows) for Text 1 and Accent 1–6 (columns).
/// `[{row, col, fill, stroke, text, gradient?, shadow}]`.
pub fn shape_styles(r: PaletteReq) -> Res {
    let s = scheme_named(r.scheme.as_deref());
    let white = Rgba::WHITE;
    let dk = s.get(SchemeSlot::Dk1);
    let cols = [
        s.get(SchemeSlot::Dk1),
        s.get(SchemeSlot::Accent1),
        s.get(SchemeSlot::Accent2),
        s.get(SchemeSlot::Accent3),
        s.get(SchemeSlot::Accent4),
        s.get(SchemeSlot::Accent5),
        s.get(SchemeSlot::Accent6),
    ];
    let on = |fill: Rgba| if dk.contrast(fill) >= white.contrast(fill) { dk } else { white };
    let mut out = vec![];
    for (row, label) in ["Colored Outline", "Colored Fill", "Light 1 Outline, Colored Fill", "Subtle Effect", "Moderate Effect", "Intense Effect"]
        .iter()
        .enumerate()
    {
        for (col, a) in cols.iter().enumerate() {
            let darker = apply(*a, &[ColorTransform::Shade(50000)]);
            let tint = apply(*a, &[ColorTransform::Tint(20000)]);
            let light = apply(*a, &[ColorTransform::Tint(60000)]);
            let v = match row {
                0 => json!({ "fill": hex(white), "stroke": hex(*a), "text": hex(dk) }),
                1 => json!({ "fill": hex(*a), "stroke": hex(darker), "text": hex(on(*a)) }),
                2 => json!({ "fill": hex(*a), "stroke": hex(white), "text": hex(on(*a)) }),
                3 => json!({ "fill": hex(tint), "stroke": hex(*a), "text": hex(on(tint)) }),
                4 => json!({ "fill": hex(*a), "stroke": null, "text": hex(on(*a)), "gradient": [hex(light), hex(*a)] }),
                _ => json!({ "fill": hex(*a), "stroke": null, "text": hex(on(*a)), "gradient": [hex(*a), hex(darker)], "shadow": true }),
            };
            let mut v = v;
            if let Some(o) = v.as_object_mut() {
                o.insert("row".into(), json!(row));
                o.insert("col".into(), json!(col));
                o.insert("label".into(), json!(label));
                o.entry("shadow").or_insert(json!(false));
            }
            out.push(v);
        }
    }
    Ok(Value::Array(out))
}
