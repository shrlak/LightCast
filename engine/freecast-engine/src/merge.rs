//! Shape Format › Merge Shapes (union, combine, fragment, intersect, subtract) and Edit Points'
//! first step (a preset's outline as an editable path). The merge rules are DeckCraft's
//! (`crates/engine/src/cmd/merge.rs`, MIT OR Apache-2.0), with the `i_overlay` crate as there.

use deckcraft_geom::preset;
use deckcraft_geom::{Affine, BezPath, PathEl, Point, Vec2};
use i_overlay::core::fill_rule::FillRule;
use i_overlay::core::overlay_rule::OverlayRule;
use i_overlay::float::single::SingleFloatOverlay;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::shapes::svg_path;
use crate::{Res, fin, to_value};

/// Closed polygons (slide pixels) describing a filled area (non-zero winding).
type Area = Vec<Vec<[f64; 2]>>;

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShapeIn {
    /// Preset name; or a custom outline in `path` drawn in a `pathW`×`pathH` box.
    #[serde(default)]
    pub shape: Option<String>,
    #[serde(default)]
    pub adj: Vec<f64>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub path_w: Option<f64>,
    #[serde(default)]
    pub path_h: Option<f64>,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    #[serde(default)]
    pub rot: f64,
    #[serde(default)]
    pub flip_h: bool,
    #[serde(default)]
    pub flip_v: bool,
}

/// The object's local box → slide: flip about the centre, rotate about the centre, place.
fn affine(s: &ShapeIn) -> Affine {
    let (w, h) = (fin(s.w, 1.0), fin(s.h, 1.0));
    let c = Vec2::new(fin(s.x, 0.0) + w / 2.0, fin(s.y, 0.0) + h / 2.0);
    Affine::translate(c)
        * Affine::rotate(fin(s.rot, 0.0).to_radians())
        * Affine::scale_non_uniform(if s.flip_h { -1.0 } else { 1.0 }, if s.flip_v { -1.0 } else { 1.0 })
        * Affine::translate(Vec2::new(-w / 2.0, -h / 2.0))
}

/// The object's outline in its own box.
fn outline(s: &ShapeIn) -> Vec<BezPath> {
    let (w, h) = (fin(s.w, 1.0).max(0.01), fin(s.h, 1.0).max(0.01));
    if let Some(d) = &s.path {
        let Ok(p) = BezPath::from_svg(d) else { return vec![] };
        let (pw, ph) = (s.path_w.unwrap_or(w).max(0.01), s.path_h.unwrap_or(h).max(0.01));
        return vec![Affine::scale_non_uniform(w / pw, h / ph) * p];
    }
    let name = s.shape.as_deref().unwrap_or("rect");
    match preset::build(name, w, h, &s.adj) {
        Some(g) => g.paths.into_iter().filter(|p| p.fill != preset::FillMode::None).map(|p| p.path).collect(),
        None => vec![],
    }
}

fn flatten(path: &BezPath, a: Affine, out: &mut Area) {
    let mut cur: Vec<[f64; 2]> = vec![];
    let flush = |cur: &mut Vec<[f64; 2]>, out: &mut Area| {
        if cur.len() > 2 {
            out.push(std::mem::take(cur));
        } else {
            cur.clear();
        }
    };
    deckcraft_geom::preset_flatten(path, &mut |el| match el {
        PathEl::MoveTo(p) => {
            flush(&mut cur, out);
            let q = a * p;
            cur.push([q.x, q.y]);
        }
        PathEl::LineTo(p) => {
            let q = a * p;
            cur.push([q.x, q.y]);
        }
        PathEl::ClosePath => flush(&mut cur, out),
        _ => {}
    });
    flush(&mut cur, out);
}

fn area_of(s: &ShapeIn) -> Area {
    let a = affine(s);
    let mut out = vec![];
    for p in outline(s) {
        flatten(&p, a, &mut out);
    }
    out
}

fn overlay(a: &Area, b: &Area, rule: OverlayRule) -> Area {
    if a.is_empty() && matches!(rule, OverlayRule::Union | OverlayRule::Xor) {
        return b.clone();
    }
    if b.is_empty() {
        return if matches!(rule, OverlayRule::Intersect) { vec![] } else { a.clone() };
    }
    a.overlay(b, rule, FillRule::NonZero).into_iter().flatten().filter(|c| c.len() > 2).collect()
}

fn area_size(a: &Area) -> f64 {
    a.iter()
        .map(|c| {
            let n = c.len();
            (0..n).map(|i| c[i][0] * c[(i + 1) % n][1] - c[(i + 1) % n][0] * c[i][1]).sum::<f64>() / 2.0
        })
        .sum::<f64>()
        .abs()
}

/// DeckCraft's merge: one area per resulting shape.
pub fn merge_areas(op: &str, areas: &[Area]) -> Vec<Area> {
    let Some((first, rest)) = areas.split_first() else { return vec![] };
    let fold = |rule| rest.iter().fold(first.clone(), |acc, b| overlay(&acc, b, rule));
    let out = match op {
        "union" => vec![fold(OverlayRule::Union)],
        "combine" => vec![fold(OverlayRule::Xor)],
        "intersect" => vec![fold(OverlayRule::Intersect)],
        "subtract" => {
            let others = rest.iter().fold(Area::new(), |acc, b| overlay(&acc, b, OverlayRule::Union));
            vec![overlay(first, &others, OverlayRule::Difference)]
        }
        _ => {
            let mut pieces: Vec<Area> = vec![first.clone()];
            let mut covered = first.clone();
            for b in rest {
                let mut next = vec![];
                for p in &pieces {
                    next.push(overlay(p, b, OverlayRule::Intersect));
                    next.push(overlay(p, b, OverlayRule::Difference));
                }
                next.push(overlay(b, &covered, OverlayRule::Difference));
                covered = overlay(&covered, b, OverlayRule::Union);
                pieces = next;
            }
            pieces
        }
    };
    out.into_iter().filter(|a| area_size(a) > 0.01).collect()
}

/// An area as a box on the slide and SVG path data relative to it.
fn area_shape(area: &Area) -> Option<Value> {
    let pts = area.iter().flatten();
    let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for p in pts {
        x0 = x0.min(p[0]);
        y0 = y0.min(p[1]);
        x1 = x1.max(p[0]);
        y1 = y1.max(p[1]);
    }
    if !(x1 > x0 && y1 > y0) {
        return None;
    }
    let f = |v: f64| {
        let s = format!("{v:.2}");
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    };
    let mut d = String::new();
    for c in area {
        for (i, p) in c.iter().enumerate() {
            d += &format!("{}{} {} ", if i == 0 { "M" } else { "L" }, f(p[0] - x0), f(p[1] - y0));
        }
        d += "Z ";
    }
    Some(json!({ "x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0, "path": d.trim_end(), "pathW": x1 - x0, "pathH": y1 - y0 }))
}

#[derive(Deserialize)]
pub struct MergeReq {
    /// union | combine | fragment | intersect | subtract
    pub mode: String,
    /// In selection order: the first one's look is kept.
    pub shapes: Vec<ShapeIn>,
}

/// `[{x, y, w, h, path, pathW, pathH}]`: the merged shapes.
pub fn merge(r: MergeReq) -> Res {
    if !matches!(r.mode.as_str(), "union" | "combine" | "fragment" | "intersect" | "subtract") {
        return Err(format!("unknown merge {}", r.mode));
    }
    if r.shapes.len() < 2 {
        return Err("select two or more shapes".into());
    }
    let areas: Vec<Area> = r.shapes.iter().map(area_of).collect();
    to_value(merge_areas(&r.mode, &areas).iter().filter_map(area_shape).collect::<Vec<_>>())
}

#[derive(Deserialize)]
pub struct ToPathReq {
    pub shape: ShapeIn,
}

/// Edit Points on a preset: its outline as path data in its own box (curves kept).
pub fn to_path(r: ToPathReq) -> Res {
    let paths = outline(&r.shape);
    let mut all = BezPath::new();
    for p in paths {
        all.extend(p.iter());
    }
    Ok(json!({ "path": svg_path(&all), "pathW": fin(r.shape.w, 1.0), "pathH": fin(r.shape.h, 1.0) }))
}

#[derive(Deserialize)]
pub struct ConnectReq {
    pub from: ShapeIn,
    pub to: ShapeIn,
    /// Connection site index on each shape; none = the nearest pair.
    #[serde(default)]
    pub from_site: Option<usize>,
    #[serde(default)]
    pub to_site: Option<usize>,
}

/// The slide positions of a shape's connection sites (the blue dots a connector glues to).
fn sites(s: &ShapeIn) -> Vec<Point> {
    let (w, h) = (fin(s.w, 1.0).max(0.01), fin(s.h, 1.0).max(0.01));
    let local: Vec<Point> = match (&s.path, preset::build(s.shape.as_deref().unwrap_or("rect"), w, h, &s.adj)) {
        (None, Some(g)) if !g.sites.is_empty() => g.sites,
        _ => vec![Point::new(w / 2.0, 0.0), Point::new(0.0, h / 2.0), Point::new(w / 2.0, h), Point::new(w, h / 2.0)],
    };
    let a = affine(s);
    local.into_iter().map(|p| a * p).collect()
}

/// Where a connector between two shapes runs: `{x0, y0, x1, y1, fromSite, toSite}`.
pub fn connect(r: ConnectReq) -> Res {
    let (a, b) = (sites(&r.from), sites(&r.to));
    if a.is_empty() || b.is_empty() {
        return Err("no connection sites".into());
    }
    let pick = |v: &[Point], i: Option<usize>| i.and_then(|i| v.get(i).copied().map(|p| (i, p)));
    let (fi, fp, ti, tp) = match (pick(&a, r.from_site), pick(&b, r.to_site)) {
        (Some((fi, fp)), Some((ti, tp))) => (fi, fp, ti, tp),
        _ => {
            let mut best = (0, a[0], 0, b[0], f64::MAX);
            for (i, p) in a.iter().enumerate() {
                for (j, q) in b.iter().enumerate() {
                    let d = (*p - *q).hypot();
                    if d < best.4 {
                        best = (i, *p, j, *q, d);
                    }
                }
            }
            (best.0, best.1, best.2, best.3)
        }
    };
    to_value(json!({ "x0": fp.x, "y0": fp.y, "x1": tp.x, "y1": tp.y, "fromSite": fi, "toSite": ti }))
}

#[derive(Deserialize)]
pub struct SitesReq {
    pub shape: ShapeIn,
}

pub fn sites_of(r: SitesReq) -> Res {
    to_value(sites(&r.shape).iter().map(|p| [p.x, p.y]).collect::<Vec<_>>())
}
