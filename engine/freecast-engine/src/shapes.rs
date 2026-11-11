//! Insert › Shapes: DeckCraft's 183 preset shapes as SVG paths, with their text box and the yellow
//! adjust handles.

use deckcraft_geom::preset::{self, CATALOG, Category, FillMode};
use deckcraft_geom::{BezPath, PathEl, Point};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{Res, fin, to_value};

/// SVG path data with coordinates rounded to 1/100.
pub fn svg_path(p: &BezPath) -> String {
    let mut s = String::new();
    let n = |v: f64| {
        let r = (fin(v, 0.0) * 100.0).round() / 100.0;
        if r == r.trunc() { format!("{}", r as i64) } else { format!("{r}") }
    };
    let pt = |s: &mut String, p: Point| {
        s.push_str(&n(p.x));
        s.push(' ');
        s.push_str(&n(p.y));
    };
    for el in p.elements() {
        if !s.is_empty() {
            s.push(' ');
        }
        match *el {
            PathEl::MoveTo(a) => {
                s.push('M');
                pt(&mut s, a);
            }
            PathEl::LineTo(a) => {
                s.push('L');
                pt(&mut s, a);
            }
            PathEl::QuadTo(a, b) => {
                s.push('Q');
                pt(&mut s, a);
                s.push(' ');
                pt(&mut s, b);
            }
            PathEl::CurveTo(a, b, c) => {
                s.push('C');
                pt(&mut s, a);
                s.push(' ');
                pt(&mut s, b);
                s.push(' ');
                pt(&mut s, c);
            }
            PathEl::ClosePath => s.push('Z'),
        }
    }
    s
}

fn category_id(c: Category) -> &'static str {
    match c {
        Category::Lines => "lines",
        Category::Rectangles => "rectangles",
        Category::BasicShapes => "basic",
        Category::BlockArrows => "arrows",
        Category::EquationShapes => "equation",
        Category::Flowchart => "flowchart",
        Category::StarsAndBanners => "stars",
        Category::Callouts => "callouts",
        Category::ActionButtons => "actionButtons",
    }
}

/// Every preset in gallery order: `[{name, label, category, line, defaults}]`.
pub fn catalog() -> Res {
    Ok(CATALOG
        .iter()
        .map(|p| {
            json!({
                "name": p.name,
                "label": p.label,
                "category": category_id(p.category),
                "line": preset::is_line_like(p.name),
                "defaults": p.defaults,
            })
        })
        .collect())
}

#[derive(Deserialize)]
pub struct GeomReq {
    pub name: String,
    pub w: f64,
    pub h: f64,
    #[serde(default)]
    pub adj: Vec<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OutPath {
    d: String,
    /// norm | none | lighten | lightenLess | darken | darkenLess
    fill: FillMode,
    stroke: bool,
    even_odd: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OutHandle {
    index: usize,
    x: f64,
    y: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OutGeom {
    paths: Vec<OutPath>,
    /// x, y, w, h of the text box inside the shape.
    text_rect: [f64; 4],
    handles: Vec<OutHandle>,
    /// Nothing is filled (lines, arcs, brackets).
    open: bool,
    /// Connection points.
    sites: Vec<[f64; 2]>,
}

/// Size limits that keep a request from asking for absurd geometry.
fn dims(w: f64, h: f64) -> (f64, f64) {
    (fin(w, 0.0).clamp(0.0, 100_000.0), fin(h, 0.0).clamp(0.0, 100_000.0))
}

/// The outline of preset `name` at `w`×`h` with adjust values `adj` (defaults where missing).
pub fn geometry(r: GeomReq) -> Res {
    let (w, h) = dims(r.w, r.h);
    let adj: Vec<f64> = r.adj.iter().map(|v| fin(*v, 0.0)).collect();
    let g = preset::build(&r.name, w, h, &adj).or_else(|| preset::build("rect", w, h, &[])).ok_or("no geometry")?;
    let open = g.is_open();
    let tr = g.text_rect;
    to_value(OutGeom {
        paths: g
            .paths
            .iter()
            .map(|s| OutPath { d: svg_path(&s.path), fill: s.fill, stroke: s.stroke, even_odd: s.even_odd })
            // A preset may carry an empty part (a blank action button's missing icon).
            .filter(|p| !p.d.is_empty())
            .collect(),
        text_rect: [tr.x0, tr.y0, tr.width(), tr.height()],
        handles: g.handles.iter().map(|h| OutHandle { index: h.index, x: h.pos.x, y: h.pos.y }).collect(),
        open,
        sites: g.sites.iter().map(|p| [p.x, p.y]).collect(),
    })
}

#[derive(Deserialize)]
pub struct AdjustReq {
    pub name: String,
    pub w: f64,
    pub h: f64,
    #[serde(default)]
    pub adj: Vec<f64>,
    /// Which handle is dragged.
    pub index: usize,
    /// Pointer in shape-local coordinates.
    pub x: f64,
    pub y: f64,
}

/// Dragging adjust handle `index` to (`x`, `y`): the shape's new adjust values.
pub fn adjust(r: AdjustReq) -> Res {
    let (w, h) = dims(r.w, r.h);
    let defaults = preset::info(&r.name).map(|i| i.defaults.to_vec()).unwrap_or_default();
    let mut adj: Vec<f64> = (0..defaults.len().max(r.adj.len())).map(|i| r.adj.get(i).or(defaults.get(i)).copied().unwrap_or(0.0)).collect();
    let g = preset::build(&r.name, w, h, &adj).ok_or("no geometry")?;
    let handle = g.handles.iter().find(|x| x.index == r.index).ok_or("no such handle")?;
    let v = handle.value_at(Point::new(fin(r.x, 0.0), fin(r.y, 0.0)));
    if adj.len() <= r.index {
        adj.resize(r.index + 1, 0.0);
    }
    adj[r.index] = v;
    to_value(adj)
}
