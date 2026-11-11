//! Draw tab: pen and highlighter strokes smoothed into SVG curves, and Ink to Shape (DeckCraft's
//! recogniser, `inkshape.rs`).

use serde::Deserialize;
use serde_json::{Value, json};

use crate::inkshape::{Recognized, recognize as dc_recognize};
use crate::{Res, fin};

#[derive(Deserialize)]
pub struct InkReq {
    pub points: Vec<[f64; 2]>,
    /// Simplification tolerance in canvas pixels.
    #[serde(default)]
    pub tolerance: f64,
}

fn clean(points: &[[f64; 2]]) -> Vec<(f64, f64)> {
    let mut v: Vec<(f64, f64)> = Vec::with_capacity(points.len().min(100_000));
    for p in points.iter().take(100_000) {
        if !(p[0].is_finite() && p[1].is_finite()) {
            continue;
        }
        if v.last().is_some_and(|l| (l.0 - p[0]).abs() < 1e-9 && (l.1 - p[1]).abs() < 1e-9) {
            continue;
        }
        v.push((p[0], p[1]));
    }
    v
}

fn seg_dist(p: (f64, f64), a: (f64, f64), b: (f64, f64)) -> f64 {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let l2 = dx * dx + dy * dy;
    if l2 < 1e-12 {
        return ((p.0 - a.0).powi(2) + (p.1 - a.1).powi(2)).sqrt();
    }
    let t = (((p.0 - a.0) * dx + (p.1 - a.1) * dy) / l2).clamp(0.0, 1.0);
    ((p.0 - a.0 - t * dx).powi(2) + (p.1 - a.1 - t * dy).powi(2)).sqrt()
}

/// Ramer–Douglas–Peucker, iterative.
pub fn simplify(pts: &[(f64, f64)], tol: f64) -> Vec<(f64, f64)> {
    if pts.len() < 3 {
        return pts.to_vec();
    }
    let mut keep = vec![false; pts.len()];
    keep[0] = true;
    keep[pts.len() - 1] = true;
    let mut stack = vec![(0usize, pts.len() - 1)];
    while let Some((a, b)) = stack.pop() {
        if b <= a + 1 {
            continue;
        }
        let (mut far, mut at) = (0.0, a);
        for (i, p) in pts.iter().enumerate().take(b).skip(a + 1) {
            let d = seg_dist(*p, pts[a], pts[b]);
            if d > far {
                far = d;
                at = i;
            }
        }
        if far > tol {
            keep[at] = true;
            stack.push((a, at));
            stack.push((at, b));
        }
    }
    pts.iter().zip(keep).filter(|(_, k)| *k).map(|(p, _)| *p).collect()
}

fn n(v: f64) -> String {
    let r = (v * 10.0).round() / 10.0;
    if r == r.trunc() { format!("{}", r as i64) } else { format!("{r}") }
}

/// A smooth path through the points (Catmull-Rom as cubic Béziers).
pub fn smooth_path(p: &[(f64, f64)]) -> String {
    match p.len() {
        0 => String::new(),
        1 => format!("M{} {} L{} {}", n(p[0].0), n(p[0].1), n(p[0].0 + 0.1), n(p[0].1)),
        _ => {
            let mut s = format!("M{} {}", n(p[0].0), n(p[0].1));
            for i in 0..p.len() - 1 {
                let p0 = if i == 0 { p[0] } else { p[i - 1] };
                let (p1, p2) = (p[i], p[i + 1]);
                let p3 = if i + 2 < p.len() { p[i + 2] } else { p2 };
                let c1 = (p1.0 + (p2.0 - p0.0) / 6.0, p1.1 + (p2.1 - p0.1) / 6.0);
                let c2 = (p2.0 - (p3.0 - p1.0) / 6.0, p2.1 - (p3.1 - p1.1) / 6.0);
                s.push_str(&format!(" C{} {} {} {} {} {}", n(c1.0), n(c1.1), n(c2.0), n(c2.1), n(p2.0), n(p2.1)));
            }
            s
        }
    }
}

/// `{d, x, y, w, h}`: the stroke as a smoothed path and its bounds.
pub fn smooth(r: InkReq) -> Res {
    let pts = clean(&r.points);
    if pts.is_empty() {
        return Ok(Value::Null);
    }
    let simple = simplify(&pts, fin(r.tolerance, 1.5).clamp(0.0, 50.0));
    let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for (x, y) in &pts {
        x0 = x0.min(*x);
        y0 = y0.min(*y);
        x1 = x1.max(*x);
        y1 = y1.max(*y);
    }
    Ok(json!({ "d": smooth_path(&simple), "x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0, "points": simple.len() }))
}

/// Ink to Shape: `{kind: line|rect|ellipse|triangle, …}` or null when the stroke is no shape.
pub fn recognize(r: InkReq) -> Res {
    let pts = clean(&r.points);
    Ok(match dc_recognize(&pts) {
        Some(Recognized::Line { x0, y0, x1, y1 }) => json!({ "kind": "line", "x0": x0, "y0": y0, "x1": x1, "y1": y1 }),
        Some(Recognized::Rect { x, y, w, h }) => json!({ "kind": "rect", "x": x, "y": y, "w": w, "h": h }),
        Some(Recognized::Ellipse { x, y, w, h }) => json!({ "kind": "ellipse", "x": x, "y": y, "w": w, "h": h }),
        Some(Recognized::Triangle { x, y, w, h, flip_v }) => json!({ "kind": "triangle", "x": x, "y": y, "w": w, "h": h, "flipV": flip_v }),
        None => Value::Null,
    })
}
