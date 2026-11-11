//! Pointer geometry of the slide editor: hit testing rotated objects, marquee selection, the
//! eight sizing handles (rotation-aware, Shift keeps the proportions, Ctrl sizes from the centre),
//! the rotation handle (Shift snaps to 15°) and smart guides with snap to grid.

use deckcraft_geom::{Point, Vec2};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{Res, fin, to_value};

/// An object's box on the slide, in canvas pixels, rotated `rot` degrees clockwise about its centre.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct BoxIn {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub rot: f64,
}

impl BoxIn {
    pub fn center(&self) -> Point {
        Point::new(fin(self.x, 0.0) + fin(self.w, 0.0) / 2.0, fin(self.y, 0.0) + fin(self.h, 0.0) / 2.0)
    }
    /// The four corners on the slide (tl, tr, br, bl).
    pub fn corners(&self) -> [Point; 4] {
        let c = self.center();
        let (hw, hh) = (fin(self.w, 0.0) / 2.0, fin(self.h, 0.0) / 2.0);
        [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)].map(|(x, y)| c + rotate(Vec2::new(x, y), fin(self.rot, 0.0)))
    }
    /// Axis-aligned bounds of the rotated box: (x0, y0, x1, y1).
    pub fn aabb(&self) -> [f64; 4] {
        let cs = self.corners();
        let mut b = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
        for p in cs {
            b[0] = b[0].min(p.x);
            b[1] = b[1].min(p.y);
            b[2] = b[2].max(p.x);
            b[3] = b[3].max(p.y);
        }
        b
    }
    /// Is `p` (slide coordinates) inside the rotated box, `tol` pixels outside counting?
    pub fn contains(&self, p: Point, tol: f64) -> bool {
        let l = rotate(p - self.center(), -fin(self.rot, 0.0));
        let (hw, hh) = (fin(self.w, 0.0).abs() / 2.0 + tol, fin(self.h, 0.0).abs() / 2.0 + tol);
        l.x.abs() <= hw && l.y.abs() <= hh
    }
}

/// `v` rotated `deg` degrees clockwise (y down).
pub fn rotate(v: Vec2, deg: f64) -> Vec2 {
    let (s, c) = fin(deg, 0.0).to_radians().sin_cos();
    Vec2::new(v.x * c - v.y * s, v.x * s + v.y * c)
}

#[derive(Deserialize)]
pub struct BoundsReq {
    pub boxes: Vec<BoxIn>,
}

/// The box around all `boxes` (as drawn, rotation included): `{x, y, w, h}` or null.
pub fn bounds(r: BoundsReq) -> Res {
    Ok(union(&r.boxes).map(|b| json!({ "x": b[0], "y": b[1], "w": b[2] - b[0], "h": b[3] - b[1] })).unwrap_or(Value::Null))
}

pub(crate) fn union(boxes: &[BoxIn]) -> Option<[f64; 4]> {
    let mut it = boxes.iter().map(BoxIn::aabb);
    let first = it.next()?;
    Some(it.fold(first, |a, b| [a[0].min(b[0]), a[1].min(b[1]), a[2].max(b[2]), a[3].max(b[3])]))
}

#[derive(Deserialize)]
pub struct HitReq {
    /// Back to front, as drawn.
    pub boxes: Vec<BoxIn>,
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub tol: f64,
}

/// The front-most object under the pointer, or null.
pub fn hit(r: HitReq) -> Res {
    let p = Point::new(fin(r.x, 0.0), fin(r.y, 0.0));
    let tol = fin(r.tol, 0.0).clamp(0.0, 100.0);
    Ok(r.boxes.iter().rev().find(|b| b.contains(p, tol)).map(|b| Value::String(b.id.clone())).unwrap_or(Value::Null))
}

#[derive(Deserialize)]
pub struct MarqueeReq {
    pub boxes: Vec<BoxIn>,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Objects lying wholly inside the dragged rectangle (as PowerPoint selects with a marquee).
pub fn marquee(r: MarqueeReq) -> Res {
    let (x0, x1) = (fin(r.x, 0.0).min(fin(r.x + r.w, 0.0)), fin(r.x, 0.0).max(fin(r.x + r.w, 0.0)));
    let (y0, y1) = (fin(r.y, 0.0).min(fin(r.y + r.h, 0.0)), fin(r.y, 0.0).max(fin(r.y + r.h, 0.0)));
    let ids: Vec<&str> = r
        .boxes
        .iter()
        .filter(|b| {
            let a = b.aabb();
            a[0] >= x0 && a[1] >= y0 && a[2] <= x1 && a[3] <= y1
        })
        .map(|b| b.id.as_str())
        .collect();
    to_value(ids)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResizeReq {
    #[serde(rename = "box")]
    pub bx: BoxIn,
    /// nw, n, ne, e, se, s, sw, w
    pub handle: String,
    /// Pointer movement since the drag started, in slide coordinates.
    pub dx: f64,
    pub dy: f64,
    #[serde(default)]
    pub keep_aspect: bool,
    #[serde(default)]
    pub from_center: bool,
    #[serde(default = "one")]
    pub min: f64,
}

fn one() -> f64 {
    1.0
}

/// The box after dragging a sizing handle: the opposite side (or the centre) stays where it is.
pub fn resize(r: ResizeReq) -> Res {
    let b = &r.bx;
    let (w, h) = (fin(b.w, 1.0).abs().max(1e-6), fin(b.h, 1.0).abs().max(1e-6));
    let rot = fin(b.rot, 0.0);
    let (hx, hy): (f64, f64) = match r.handle.as_str() {
        "nw" => (-1.0, -1.0),
        "n" => (0.0, -1.0),
        "ne" => (1.0, -1.0),
        "e" => (1.0, 0.0),
        "se" => (1.0, 1.0),
        "s" => (0.0, 1.0),
        "sw" => (-1.0, 1.0),
        "w" => (-1.0, 0.0),
        _ => return Err(format!("unknown handle {}", r.handle)),
    };
    let d = rotate(Vec2::new(fin(r.dx, 0.0), fin(r.dy, 0.0)), -rot);
    let k = if r.from_center { 2.0 } else { 1.0 };
    let min = fin(r.min, 1.0).max(0.0);
    let mut nw = (w + hx * d.x * k).max(min);
    let mut nh = (h + hy * d.y * k).max(min);
    if r.keep_aspect {
        let s = if hx != 0.0 && hy != 0.0 {
            // Corner: whichever side moved further sets the scale.
            if (nw / w - 1.0).abs() >= (nh / h - 1.0).abs() { nw / w } else { nh / h }
        } else if hx != 0.0 {
            nw / w
        } else {
            nh / h
        };
        let s = s.max(min / w.min(h));
        nw = w * s;
        nh = h * s;
    }
    let c = b.center();
    let center = if r.from_center {
        c
    } else {
        // The fixed point: the opposite corner / edge middle (an edge drag keeps the other axis centred).
        let anchor = c + rotate(Vec2::new(-hx * w / 2.0, -hy * h / 2.0), rot);
        anchor - rotate(Vec2::new(-hx * nw / 2.0, -hy * nh / 2.0), rot)
    };
    to_value(json!({ "x": center.x - nw / 2.0, "y": center.y - nh / 2.0, "w": nw, "h": nh }))
}

#[derive(Deserialize)]
pub struct RotateToReq {
    #[serde(rename = "box")]
    pub bx: BoxIn,
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub snap: bool,
}

/// The rotation that points the rotation handle (above the top edge) at the pointer, 0–360°.
pub fn rotate_to(r: RotateToReq) -> Res {
    let c = r.bx.center();
    let v = Point::new(fin(r.x, c.x), fin(r.y, c.y)) - c;
    if v.hypot() < 1e-9 {
        return to_value(fin(r.bx.rot, 0.0));
    }
    let mut a = v.x.atan2(-v.y).to_degrees();
    if r.snap {
        a = (a / 15.0).round() * 15.0;
    }
    let a = (a.rem_euclid(360.0) * 100.0).round() / 100.0;
    to_value(if a >= 360.0 { 0.0 } else { a })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapReq {
    #[serde(rename = "box")]
    pub bx: BoxIn,
    #[serde(default)]
    pub others: Vec<BoxIn>,
    pub slide_w: f64,
    pub slide_h: f64,
    /// Canvas pixels within which an edge or centre jumps onto a guide.
    #[serde(default = "snap_distance")]
    pub distance: f64,
    /// Snap to a grid of this spacing (0: off).
    #[serde(default)]
    pub grid: f64,
    /// Drawing guides the user placed: vertical x positions, horizontal y positions.
    #[serde(default)]
    pub guides_v: Vec<f64>,
    #[serde(default)]
    pub guides_h: Vec<f64>,
    /// Smart guides (other objects' edges and centres, the slide's edges and centre).
    #[serde(default = "yes")]
    pub smart: bool,
}

fn snap_distance() -> f64 {
    12.0
}
fn yes() -> bool {
    true
}

/// Snap one axis: the box's start, middle or end onto the nearest target within `dist`.
fn snap_axis(pos: f64, size: f64, targets: &[f64], dist: f64) -> (f64, Option<f64>) {
    let mut best: Option<(f64, f64, f64)> = None;
    for edge in [0.0, size / 2.0, size] {
        for &t in targets {
            let d = (pos + edge - t).abs();
            if d <= dist && best.is_none_or(|b| d < b.2) {
                best = Some(((t - edge).round(), t, d));
            }
        }
    }
    match best {
        Some((p, line, _)) => (p, Some(line)),
        None => (pos, None),
    }
}

/// A moved box placed on the nearest guide or grid line, with the guide lines it sits on (to draw).
pub fn snap(r: SnapReq) -> Res {
    let b = &r.bx;
    let (sw, sh) = (fin(r.slide_w, 1440.0), fin(r.slide_h, 1080.0));
    let dist = fin(r.distance, 12.0).clamp(0.0, 200.0);
    let mut xs: Vec<f64> = r.guides_v.iter().map(|v| fin(*v, 0.0)).collect();
    let mut ys: Vec<f64> = r.guides_h.iter().map(|v| fin(*v, 0.0)).collect();
    if r.smart {
        xs.extend([0.0, sw / 2.0, sw]);
        ys.extend([0.0, sh / 2.0, sh]);
        for o in &r.others {
            let a = o.aabb();
            xs.extend([a[0], (a[0] + a[2]) / 2.0, a[2]]);
            ys.extend([a[1], (a[1] + a[3]) / 2.0, a[3]]);
        }
    }
    let a = b.aabb();
    let (bw, bh) = (a[2] - a[0], a[3] - a[1]);
    let (mut x0, lx) = snap_axis(a[0], bw, &xs, dist);
    let (mut y0, ly) = snap_axis(a[1], bh, &ys, dist);
    let grid = fin(r.grid, 0.0);
    if grid > 0.5 {
        if lx.is_none() {
            x0 = (a[0] / grid).round() * grid;
        }
        if ly.is_none() {
            y0 = (a[1] / grid).round() * grid;
        }
    }
    // Move the unrotated box by however much its drawn bounds moved.
    let (dx, dy) = (x0 - a[0], y0 - a[1]);
    let clamp = |v: f64, max: f64| v.clamp(0.0, max);
    to_value(json!({
        "x": fin(b.x, 0.0) + dx,
        "y": fin(b.y, 0.0) + dy,
        "guides": { "v": lx.map(|v| vec![clamp(v, sw)]).unwrap_or_default(), "h": ly.map(|v| vec![clamp(v, sh)]).unwrap_or_default() }
    }))
}
