//! Home › Arrange and Shape Format › Arrange: align, distribute, bring forward / send backward,
//! rotate and flip. The ordering rules are DeckCraft's (`engine/src/cmd/arrange.rs`); the rest works
//! on LightCast's boxes (canvas pixels).

use deckcraft_geom::{Point, Vec2};
use serde::Deserialize;
use serde_json::json;

use crate::geometry::{BoxIn, rotate, union};
use crate::{Res, fin, to_value};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignReq {
    pub boxes: Vec<BoxIn>,
    /// left | center | right | top | middle | bottom
    pub edge: String,
    /// slide | selection (one object always aligns to the slide)
    #[serde(default)]
    pub to: String,
    pub slide_w: f64,
    pub slide_h: f64,
}

/// How far each object moves: `[{id, dx, dy}]`.
pub fn align(r: AlignReq) -> Res {
    let (sw, sh) = (fin(r.slide_w, 1440.0), fin(r.slide_h, 1080.0));
    let frame = if r.to == "selection" && r.boxes.len() > 1 { union(&r.boxes).unwrap_or([0.0, 0.0, sw, sh]) } else { [0.0, 0.0, sw, sh] };
    let out: Vec<_> = r
        .boxes
        .iter()
        .map(|b| {
            let a = b.aabb();
            let (dx, dy) = match r.edge.as_str() {
                "left" => (frame[0] - a[0], 0.0),
                "center" => ((frame[0] + frame[2]) / 2.0 - (a[0] + a[2]) / 2.0, 0.0),
                "right" => (frame[2] - a[2], 0.0),
                "top" => (0.0, frame[1] - a[1]),
                "middle" => (0.0, (frame[1] + frame[3]) / 2.0 - (a[1] + a[3]) / 2.0),
                "bottom" => (0.0, frame[3] - a[3]),
                _ => (0.0, 0.0),
            };
            json!({ "id": b.id, "dx": dx.round(), "dy": dy.round() })
        })
        .collect();
    to_value(out)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DistributeReq {
    pub boxes: Vec<BoxIn>,
    /// horizontal | vertical
    pub dir: String,
    #[serde(default)]
    pub to: String,
    pub slide_w: f64,
    pub slide_h: f64,
}

/// Equal gaps between the objects: across the selection (the outer two stay), or across the slide
/// (the outer two go to its edges). `[{id, dx, dy}]`.
pub fn distribute(r: DistributeReq) -> Res {
    let horiz = r.dir != "vertical";
    let (sw, sh) = (fin(r.slide_w, 1440.0), fin(r.slide_h, 1080.0));
    let mut items: Vec<(&BoxIn, [f64; 4])> = r.boxes.iter().map(|b| (b, b.aabb())).collect();
    let lo = |a: &[f64; 4]| if horiz { a[0] } else { a[1] };
    let size = |a: &[f64; 4]| if horiz { a[2] - a[0] } else { a[3] - a[1] };
    items.sort_by(|a, b| (lo(&a.1) + size(&a.1) / 2.0).total_cmp(&(lo(&b.1) + size(&b.1) / 2.0)));
    let to_slide = r.to != "selection" || items.len() < 3;
    let (start, end) = if to_slide {
        (0.0, if horiz { sw } else { sh })
    } else {
        let first = items.first().map(|x| lo(&x.1)).unwrap_or(0.0);
        let last = items.last().map(|x| lo(&x.1) + size(&x.1)).unwrap_or(0.0);
        (first, last)
    };
    let total: f64 = items.iter().map(|x| size(&x.1)).sum();
    let n = items.len();
    let gap = if n > 1 { (end - start - total) / (n as f64 - 1.0) } else { 0.0 };
    let mut at = start;
    let mut out = vec![];
    for (i, (b, a)) in items.iter().enumerate() {
        let target = if n == 1 { (start + end) / 2.0 - size(a) / 2.0 } else { at };
        let d = if !to_slide && (i == 0 || i + 1 == n) { 0.0 } else { (target - lo(a)).round() };
        out.push(if horiz { json!({ "id": b.id, "dx": d, "dy": 0.0 }) } else { json!({ "id": b.id, "dx": 0.0, "dy": d }) });
        at += size(a) + gap;
    }
    to_value(out)
}

#[derive(Deserialize)]
pub struct OrderReq {
    /// Every object id, back to front.
    pub ids: Vec<String>,
    /// The ones to move.
    pub sel: Vec<String>,
    /// front | forward | backward | back
    pub how: String,
}

/// The new back-to-front order.
pub fn order(r: OrderReq) -> Res {
    let mut list = r.ids.clone();
    let is = |x: &String| r.sel.contains(x);
    match r.how.as_str() {
        "front" => {
            let (moved, rest): (Vec<String>, Vec<String>) = list.drain(..).partition(|x| is(x));
            list = rest;
            list.extend(moved);
        }
        "back" => {
            let (mut moved, rest): (Vec<String>, Vec<String>) = list.drain(..).partition(|x| is(x));
            moved.extend(rest);
            list = moved;
        }
        "forward" => {
            for i in (0..list.len().saturating_sub(1)).rev() {
                if is(&list[i]) && !is(&list[i + 1]) {
                    list.swap(i, i + 1);
                }
            }
        }
        "backward" => {
            for i in 1..list.len() {
                if !is(&list[i - 1]) && is(&list[i]) {
                    list.swap(i - 1, i);
                }
            }
        }
        other => return Err(format!("unknown order {other}")),
    }
    to_value(list)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlipReq {
    pub boxes: Vec<BoxIn>,
    /// horizontal | vertical
    pub axis: String,
    /// Mirror the positions across the selection too (a group flips as a whole).
    #[serde(default)]
    pub as_group: bool,
}

/// Each object's place and rotation after a flip: `[{id, x, y, rot}]` (the caller toggles its
/// mirror flag).
pub fn flip(r: FlipReq) -> Res {
    let horiz = r.axis != "vertical";
    let frame = union(&r.boxes).unwrap_or([0.0; 4]);
    let (cx, cy) = ((frame[0] + frame[2]) / 2.0, (frame[1] + frame[3]) / 2.0);
    let out: Vec<_> = r
        .boxes
        .iter()
        .map(|b| {
            let c = b.center();
            let (ncx, ncy) = if r.as_group { if horiz { (2.0 * cx - c.x, c.y) } else { (c.x, 2.0 * cy - c.y) } } else { (c.x, c.y) };
            let rot = (360.0 - fin(b.rot, 0.0)).rem_euclid(360.0);
            json!({ "id": b.id, "x": ncx - fin(b.w, 0.0) / 2.0, "y": ncy - fin(b.h, 0.0) / 2.0, "rot": rot })
        })
        .collect();
    to_value(out)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RotateReq {
    pub boxes: Vec<BoxIn>,
    /// Degrees clockwise (Rotate Right 90° = 90, Left = -90).
    pub by: f64,
    #[serde(default)]
    pub as_group: bool,
}

/// `[{id, x, y, rot}]` after rotating each object (or the group about its centre).
pub fn rotate_by(r: RotateReq) -> Res {
    let by = fin(r.by, 0.0);
    let frame = union(&r.boxes).unwrap_or([0.0; 4]);
    let pivot = Point::new((frame[0] + frame[2]) / 2.0, (frame[1] + frame[3]) / 2.0);
    let out: Vec<_> = r
        .boxes
        .iter()
        .map(|b| {
            let c = b.center();
            let nc = if r.as_group { pivot + rotate(Vec2::new(c.x - pivot.x, c.y - pivot.y), by) } else { c };
            json!({ "id": b.id, "x": nc.x - fin(b.w, 0.0) / 2.0, "y": nc.y - fin(b.h, 0.0) / 2.0, "rot": (fin(b.rot, 0.0) + by).rem_euclid(360.0) })
        })
        .collect();
    to_value(out)
}
