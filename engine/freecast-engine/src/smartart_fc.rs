//! Insert › SmartArt: DeckCraft's 45 SmartArt layouts (lists, processes, cycles, hierarchies,
//! pyramids, matrices, Venn, target, funnel, gear, timeline, org charts…) with its SmartArt Styles
//! and Change Colors, laid out by DeckCraft's own layout code and handed to FreeCast as plain
//! shapes (preset or custom outline, fill, line, text and the nodes each shape shows).

use deckcraft_color::{ColorScheme, Rgba, SchemeSlot};
use deckcraft_geom::Xfrm;
use deckcraft_model::text::Align;
use deckcraft_model::{ColorRef, Diagram, DiagramNode, Fill, Geom, Line, Shape};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::color::{hex, scheme_named};
use crate::smartart::{COLORS, LAYOUTS, STYLES};
use crate::{Res, fin, to_value};

/// `{layouts: [{id, label}], styles, colors}`.
pub fn catalog() -> Res {
    let pairs = |v: &[(&str, &str)]| v.iter().map(|(id, label)| json!({ "id": id, "label": label })).collect::<Vec<_>>();
    Ok(json!({ "layouts": pairs(&LAYOUTS), "styles": pairs(&STYLES), "colors": pairs(&COLORS) }))
}

#[derive(Deserialize)]
pub struct NodeIn {
    pub text: String,
    #[serde(default)]
    pub level: u8,
}

#[derive(Deserialize)]
pub struct LayoutReq {
    pub kind: String,
    pub nodes: Vec<NodeIn>,
    #[serde(default)]
    pub style: String,
    #[serde(default)]
    pub colors: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    #[serde(default)]
    pub scheme: Option<String>,
}

fn color(c: &ColorRef, s: &ColorScheme) -> String {
    hex(c.resolve(s, None))
}

fn fill_of(f: Option<&Fill>, s: &ColorScheme) -> (Option<String>, Option<[String; 2]>) {
    match f {
        Some(Fill::Solid { color: c }) => (Some(color(c, s)), None),
        Some(Fill::Gradient(g)) => {
            let first = g.stops.first().map(|x| color(&x.color, s));
            let last = g.stops.last().map(|x| color(&x.color, s));
            match (first, last) {
                (Some(a), Some(b)) => (Some(a.clone()), Some([a, b])),
                _ => (None, None),
            }
        }
        Some(Fill::None) => (Some("transparent".into()), None),
        _ => (None, None),
    }
}

fn line_of(l: Option<&Line>, s: &ColorScheme) -> (Option<String>, f64) {
    match l {
        Some(line) => match &line.fill {
            Some(Fill::Solid { color: c }) => (Some(color(c, s)), line.width.unwrap_or(1.0)),
            _ => (None, 0.0),
        },
        None => (None, 0.0),
    }
}

/// One laid-out shape as a FreeCast object description.
fn shape_json(sh: &Shape, nodes: &[usize], s: &ColorScheme) -> Value {
    let x = sh.xfrm.unwrap_or(Xfrm::new(0.0, 0.0, 10.0, 10.0));
    let (fill, gradient) = fill_of(sh.fill.as_ref(), s);
    let (stroke, stroke_w) = line_of(sh.line.as_ref(), s);
    let (preset, adj, custom) = match &sh.geom {
        Geom::Preset { name, adj } => (Some(name.clone()), adj.clone(), None),
        Geom::Custom { paths } => {
            let p = paths.first();
            (None, vec![], p.map(|p| json!({ "d": paths.iter().map(|q| q.d.clone()).collect::<Vec<_>>().join(" "), "w": p.w, "h": p.h })))
        }
    };
    let text = sh.text.as_ref().map(|t| t.text()).unwrap_or_default();
    let mut text_color = None;
    let mut size = None;
    let mut bold = None;
    let mut align = None;
    if let Some(t) = &sh.text {
        if let Some(p) = t.paragraphs.first() {
            align = p.props.align.map(|a| match a {
                Align::Left => "left",
                Align::Right => "right",
                Align::Justify | Align::Distributed => "justify",
                _ => "center",
            });
            let props = p.runs.first().map(|r| &r.props).unwrap_or(&p.def_props);
            if let Some(Fill::Solid { color: c }) = props.fill.as_ref().or(p.def_props.fill.as_ref()) {
                text_color = Some(color(c, s));
            }
            size = props.size.or(p.def_props.size);
            bold = props.bold.or(p.def_props.bold);
        }
    }
    // Text on a filled shape without its own colour: whichever of dark and light reads better.
    if text_color.is_none() && !text.is_empty() {
        let bg = fill.as_deref().and_then(Rgba::from_hex).unwrap_or(Rgba::WHITE);
        let (dk, lt) = (s.get(SchemeSlot::Dk1), s.get(SchemeSlot::Lt1));
        text_color = Some(hex(if dk.contrast(bg) >= lt.contrast(bg) { dk } else { lt }));
    }
    let shadow = sh.effects.as_ref().is_some_and(|e| e.outer_shadow.is_some());
    json!({
        "shape": preset, "adj": adj, "custom": custom,
        "x": x.x, "y": x.y, "w": x.w, "h": x.h, "rot": x.rot, "flipH": x.flip_h, "flipV": x.flip_v,
        "fill": fill, "gradient": gradient, "stroke": stroke, "strokeWidth": stroke_w * 2.0,
        "text": text, "color": text_color, "fontSize": size.map(|v| v * 2.0), "bold": bold, "align": align,
        "shadow": shadow, "nodes": nodes,
    })
}

/// The shapes of a SmartArt graphic laid out in (`x`, `y`, `w`, `h`), canvas pixels.
pub fn layout(r: LayoutReq) -> Res {
    if !LAYOUTS.iter().any(|l| l.0 == r.kind) {
        return Err(format!("unknown SmartArt layout {}", r.kind));
    }
    let s = scheme_named(r.scheme.as_deref());
    let mut nodes: Vec<DiagramNode> = r
        .nodes
        .iter()
        .take(200)
        .map(|n| DiagramNode { text: n.text.clone(), level: n.level.min(crate::smartart::MAX_LEVEL), ..Default::default() })
        .collect();
    crate::smartart::nodes::normalize(&mut nodes);
    let d = Diagram { kind: r.kind.clone(), nodes, style: r.style.clone(), colors: r.colors.clone(), ..Default::default() };
    // Layout works in points; FreeCast's canvas has two pixels per point.
    let area = Xfrm::new(fin(r.x, 0.0) / 2.0, fin(r.y, 0.0) / 2.0, fin(r.w, 400.0).max(10.0) / 2.0, fin(r.h, 300.0).max(10.0) / 2.0);
    let items = crate::smartart::items(&d, area);
    let shapes: Vec<Value> = items
        .iter()
        // A branch line of no length (an org chart level with one box) draws nothing.
        .filter(|(sh, _)| sh.xfrm.is_none_or(|x| x.w > 0.01 || x.h > 0.01))
        .map(|(sh, nodes)| {
            let mut v = shape_json(sh, nodes, &s);
            if let Some(o) = v.as_object_mut() {
                for k in ["x", "y", "w", "h"] {
                    if let Some(n) = o.get(k).and_then(Value::as_f64) {
                        o.insert(k.into(), json!(n * 2.0));
                    }
                }
                if let Some(c) = o.get_mut("custom").and_then(Value::as_object_mut) {
                    // Custom outlines keep their own coordinate space; the object's box scales them.
                    let _ = c;
                }
            }
            v
        })
        .collect();
    to_value(json!({ "shapes": shapes }))
}

#[derive(Deserialize)]
pub struct FromLinesReq {
    pub lines: Vec<String>,
}

/// Text pane lines (a leading tab per outline level) → nodes.
pub fn nodes_from_lines(r: FromLinesReq) -> Res {
    let nodes = crate::smartart::nodes::nodes_from_lines(r.lines.iter().map(String::as_str));
    to_value(nodes.iter().map(|n| json!({ "text": n.text, "level": n.level })).collect::<Vec<_>>())
}
