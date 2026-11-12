//! Chart layouts that have no value axis of their own: funnel, treemap, sunburst, radar and surface
//! (ported from DeckCraft's `chartex.rs` and `radar.rs`, drawn as SVG).

use std::f64::consts::{FRAC_PI_2, TAU};
use std::fmt::Write;

use deckcraft_model::chart as dm;

use crate::chart::{Area, ChartReq, Ink, esc, fit, label, model_chart, n, nice_axis, tw};

/// A rectangle by its edges.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
}

impl Rect {
    pub const ZERO: Rect = Rect { x0: 0.0, y0: 0.0, x1: 0.0, y1: 0.0 };
    pub fn w(&self) -> f64 {
        self.x1 - self.x0
    }
    pub fn h(&self) -> f64 {
        self.y1 - self.y0
    }
    pub fn area(&self) -> f64 {
        self.w().max(0.0) * self.h().max(0.0)
    }
}

/// Squarified treemap (Bruls, Huizing, van Wijk): rows of tiles laid along the short side, each row
/// kept while it improves the worst aspect ratio. Zero and negative values get an empty rectangle.
pub fn squarify(vals: &[f64], r: Rect) -> Vec<Rect> {
    let total: f64 = vals.iter().filter(|v| **v > 0.0).sum();
    let mut out = vec![Rect::ZERO; vals.len()];
    if total <= 0.0 || r.area() <= 0.0 {
        return out;
    }
    let scale = r.area() / total;
    let mut order: Vec<usize> = (0..vals.len()).filter(|&i| vals[i] > 0.0).collect();
    order.sort_by(|a, b| vals[*b].total_cmp(&vals[*a]));
    let mut free = r;
    let mut i = 0;
    while i < order.len() {
        let short = free.w().min(free.h());
        if !short.is_finite() || short <= 1e-9 {
            break;
        }
        let s2 = short * short;
        let a0 = vals[order[i]] * scale;
        let (mut cur_sum, mut cur_max, mut cur_min) = (a0, a0, a0);
        let mut cur_worst = ((s2 * cur_max) / (cur_sum * cur_sum)).max((cur_sum * cur_sum) / (s2 * cur_min));
        let mut end = i + 1;
        while end < order.len() {
            let next_a = vals[order[end]] * scale;
            let cand_sum = cur_sum + next_a;
            let cand_max = cur_max.max(next_a);
            let cand_min = cur_min.min(next_a);
            let cand_worst = ((s2 * cand_max) / (cand_sum * cand_sum)).max((cand_sum * cand_sum) / (s2 * cand_min));
            if cand_worst.is_finite() && cand_worst <= cur_worst {
                cur_sum = cand_sum;
                cur_max = cand_max;
                cur_min = cand_min;
                cur_worst = cand_worst;
                end += 1;
            } else {
                break;
            }
        }
        let row = &order[i..end];
        let thick = cur_sum / short;
        if !thick.is_finite() || thick <= 0.0 {
            break;
        }
        let wide = free.w() >= free.h();
        let mut at = 0.0;
        for &k in row {
            let len = vals[k] * scale / thick;
            out[k] = if wide {
                Rect { x0: free.x0, y0: free.y0 + at, x1: free.x0 + thick, y1: free.y0 + at + len }
            } else {
                Rect { x0: free.x0 + at, y0: free.y0, x1: free.x0 + at + len, y1: free.y0 + thick }
            };
            at += len;
        }
        free = if wide { Rect { x0: free.x0 + thick, ..free } } else { Rect { y0: free.y0 + thick, ..free } };
        i = end;
    }
    out
}

/// Mix `hex` (#rrggbb) toward white by `k`.
fn lighten(hex: &str, k: f64) -> String {
    let k = k.clamp(0.0, 0.8);
    let p = |i: usize| u8::from_str_radix(hex.get(i..i + 2).unwrap_or("00"), 16).unwrap_or(0) as f64;
    let f = |v: f64| (v + (255.0 - v) * k).round() as u8;
    format!("#{:02x}{:02x}{:02x}", f(p(1)), f(p(3)), f(p(5)))
}

fn text_at(s: &mut String, x: f64, y: f64, anchor: &str, fill: &str, bold: bool, size: f64, t: &str) {
    if t.is_empty() {
        return;
    }
    let _ = write!(s, r#"<text x="{}" y="{}" text-anchor="{}" fill="{}" font-size="{}"{}>{}</text>"#, n(x), n(y), anchor, fill, n(size), if bold { r#" font-weight="600""# } else { "" }, esc(t));
}

fn observations(r: &ChartReq) -> Vec<f64> {
    r.series.first().map(|s| s.values.iter().map(|v| if v.is_finite() { v.max(0.0) } else { 0.0 }).collect()).unwrap_or_default()
}

/// Funnel: bars centred on one axis, as wide as their value, category labels on the left.
pub(crate) fn funnel(s: &mut String, r: &ChartReq, ink: &Ink, a: Area) {
    let fs = ink.fs;
    let vals = observations(r);
    if vals.iter().all(|v| *v <= 0.0) {
        return;
    }
    let nn = vals.len().max(1);
    let gutter = r.categories.iter().map(|c| tw(c, fs)).fold(0.0, f64::max) + fs;
    let x0 = a.x0 + gutter.min(a.w() * 0.4);
    let (cx, pw) = ((x0 + a.x1) / 2.0, a.x1 - x0);
    let max = vals.iter().copied().fold(0.0, f64::max).max(1e-9);
    let band = a.h() / nn as f64;
    let col = esc(&ink.color(0, &r.series.first().and_then(|x| x.color.clone())));
    for (i, v) in vals.iter().enumerate() {
        let w = v / max * pw;
        let y = a.y0 + band * i as f64;
        let _ = write!(s, r#"<rect x="{}" y="{}" width="{}" height="{}" fill="{}"/>"#, n(cx - w / 2.0), n(y + band * 0.05), n(w), n(band * 0.9), col);
        if let Some(name) = r.categories.get(i) {
            text_at(s, x0 - fs * 0.4, y + band / 2.0 + fs * 0.35, "end", &ink.tc, false, fs, name);
        }
        // Values sit inside the bars, as PowerPoint writes them.
        text_at(s, cx, y + band / 2.0 + fs * 0.35, "middle", "#ffffff", false, fs, &label(*v));
    }
}

/// Treemap: the first series as a hierarchy (outer levels from `categoryLevels`), groups with a banner
/// along the top and their children squarified inside; a group and everything in it take its colour.
pub(crate) fn treemap(s: &mut String, r: &ChartReq, ink: &Ink, a: Area) {
    let tree = model_chart(r, dm::ChartType::Treemap).category_tree();
    if tree.iter().all(|t| t.value <= 0.0) {
        return;
    }
    #[allow(clippy::too_many_arguments)]
    fn place(s: &mut String, ink: &Ink, nodes: &[dm::TreeNode], r: Rect, labels: bool, col: &dyn Fn(usize) -> String, depth: usize) {
        let fs = ink.fs;
        let vals: Vec<f64> = nodes.iter().map(|t| t.value).collect();
        for (i, (node, t)) in nodes.iter().zip(squarify(&vals, r)).enumerate() {
            if t.area() <= 0.0 {
                continue;
            }
            let fill = col(i);
            let rect = format!(r##"<rect x="{}" y="{}" width="{}" height="{}" fill="{}" stroke="#ffffff" stroke-width="{}"/>"##, n(t.x0), n(t.y0), n(t.w()), n(t.h()), fill, n(fs * 0.08));
            s.push_str(&rect);
            if node.children.is_empty() {
                let (inner_w, inner_h) = (t.w() - fs * 0.6, t.h() - fs * 0.6);
                if inner_w > fs && inner_h > fs {
                    let name = fit(&node.name, inner_w, fs * 0.9);
                    text_at(s, t.x0 + fs * 0.3, t.y0 + fs * 1.1, "start", "#ffffff", false, fs * 0.9, &name);
                    if labels && inner_h > fs * 2.2 {
                        text_at(s, t.x0 + fs * 0.3, t.y0 + fs * 2.2, "start", "#ffffff", false, fs * 0.9, &label(node.value));
                    }
                }
                continue;
            }
            // A group: its banner, then its children below it.
            let banner = (fs * 1.5).min(t.h() * 0.3);
            if t.w() > fs * 2.0 && banner > fs * 0.8 {
                text_at(s, t.x0 + fs * 0.3, t.y0 + banner / 2.0 + fs * 0.35, "start", "#ffffff", true, fs, &fit(&node.name, t.w() - fs * 0.6, fs));
            }
            let inner = Rect { x0: t.x0 + 1.0, y0: t.y0 + banner, x1: t.x1 - 1.0, y1: t.y1 - 1.0 };
            let k = lighten(&fill, 0.12 * (depth + 1) as f64);
            place(s, ink, &node.children, inner, labels, &|_| k.clone(), depth + 1);
        }
    }
    let rect = Rect { x0: a.x0, y0: a.y0, x1: a.x1, y1: a.y1 };
    place(s, ink, &tree, rect, r.data_labels, &|i| ink.palette(i), 0);
}

/// One ring segment between radii `ri` and `ro` from angle `a` over `sweep`.
fn segment(cx: f64, cy: f64, ri: f64, ro: f64, a: f64, sweep: f64) -> String {
    let sweep = sweep.min(TAU * 0.9999);
    let b = a + sweep;
    let large = if sweep > std::f64::consts::PI { 1 } else { 0 };
    let p = |r: f64, t: f64| (n(cx + r * t.cos()), n(cy + r * t.sin()));
    let (o0, o1, i0, i1) = (p(ro, a), p(ro, b), p(ri, a), p(ri, b));
    if ri <= 0.01 {
        return format!("M{} {} L{} {} A{} {} 0 {} 1 {} {} Z", n(cx), n(cy), o0.0, o0.1, n(ro), n(ro), large, o1.0, o1.1);
    }
    format!("M{} {} L{} {} A{} {} 0 {} 1 {} {} L{} {} A{} {} 0 {} 0 {} {} Z", i0.0, i0.1, o0.0, o0.1, n(ro), n(ro), large, o1.0, o1.1, i1.0, i1.1, n(ri), n(ri), large, i0.0, i0.1)
}

/// Sunburst: the top level as the inner ring, each deeper level in the next ring out within its
/// parent's angle, coloured by top-level group and lighter further out.
pub(crate) fn sunburst(s: &mut String, r: &ChartReq, ink: &Ink, a: Area) {
    let tree = model_chart(r, dm::ChartType::Sunburst).category_tree();
    fn depth(nodes: &[dm::TreeNode]) -> usize {
        nodes.iter().map(|c| 1 + depth(&c.children)).max().unwrap_or(0)
    }
    let levels = depth(&tree).max(1);
    if tree.iter().map(|t| t.value).sum::<f64>() <= 0.0 {
        return;
    }
    let rad = a.w().min(a.h()) / 2.0 * 0.95;
    let hole = if levels > 1 { rad * 0.2 } else { rad * 0.35 };
    let ring = (rad - hole) / levels as f64;
    let (cx, cy) = ((a.x0 + a.x1) / 2.0, (a.y0 + a.y1) / 2.0);
    #[allow(clippy::too_many_arguments)]
    fn ring_of(s: &mut String, ink: &Ink, nodes: &[dm::TreeNode], a0: f64, span: f64, d: usize, geo: (f64, f64, f64, f64), col: &dyn Fn(usize) -> String) {
        let (cx, cy, hole, ring) = geo;
        let fs = ink.fs;
        let sum: f64 = nodes.iter().map(|t| t.value).sum();
        if sum <= 0.0 {
            return;
        }
        let (ri, ro) = (hole + ring * d as f64, hole + ring * (d + 1) as f64);
        let mut ang = a0;
        for (i, node) in nodes.iter().enumerate() {
            let sweep = node.value / sum * span;
            if sweep <= 0.0 {
                continue;
            }
            let fill = col(i);
            let _ = write!(s, r##"<path d="{}" fill="{}" stroke="#ffffff" stroke-width="{}"/>"##, segment(cx, cy, ri, ro, ang, sweep), fill, n(fs * 0.1));
            let (mid, rr) = (ang + sweep / 2.0, (ri + ro) / 2.0);
            // A label only where the segment has room for it.
            if sweep * rr > fs * 2.5 && !node.name.is_empty() {
                text_at(s, cx + rr * mid.cos(), cy + rr * mid.sin() + fs * 0.3, "middle", "#ffffff", false, fs * 0.9, &fit(&node.name, (ring * 0.96).max(fs), fs * 0.9));
            }
            if !node.children.is_empty() {
                let k = lighten(&fill, 0.15);
                ring_of(s, ink, &node.children, ang, sweep, d + 1, geo, &|_| k.clone());
            }
            ang += sweep;
        }
    }
    ring_of(s, ink, &tree, -FRAC_PI_2, TAU, 0, (cx, cy, hole, ring), &|i| ink.palette(i));
}

/// Radar: one spoke per category with the value axis up the first spoke, a polygon of gridlines per
/// major unit and each series a closed polygon (filled for a filled radar).
pub(crate) fn radar(s: &mut String, r: &ChartReq, ink: &Ink, a: Area, filled: bool) {
    let fs = ink.fs;
    let tc = &ink.tc;
    let nn = r.categories.len().max(r.series.iter().map(|x| x.values.len()).max().unwrap_or(0));
    if nn < 3 {
        // Fewer than three spokes make no polygon.
        return;
    }
    let rad = (a.w().min(a.h()) / 2.0 - fs * 1.9).max(fs);
    let (cx, cy) = ((a.x0 + a.x1) / 2.0, (a.y0 + a.y1) / 2.0);
    let (mut lo, mut hi) = (0.0f64, 0.0f64);
    for v in r.series.iter().flat_map(|x| x.values.iter()).filter(|v| v.is_finite()) {
        lo = lo.min(*v);
        hi = hi.max(*v);
    }
    let (vmin, vmax, step) = nice_axis(lo, hi, 5);
    let span = (vmax - vmin).max(1e-9);
    let ticks = (((vmax - vmin) / step).round() as usize).clamp(1, 20);
    let spoke = |i: usize, frac: f64| {
        let ang = -FRAC_PI_2 + TAU * i as f64 / nn as f64;
        (cx + rad * frac * ang.cos(), cy + rad * frac * ang.sin())
    };
    if r.gridlines {
        for k in 1..=ticks {
            let pts: String = (0..nn).map(|i| { let p = spoke(i, k as f64 / ticks as f64); format!("{}{} {}", if i == 0 { "M" } else { " L" }, n(p.0), n(p.1)) }).collect();
            let _ = write!(s, r#"<path d="{} Z" fill="none" stroke="{}" stroke-opacity="0.25"/>"#, pts, tc);
        }
    }
    for i in 0..nn {
        let p = spoke(i, 1.0);
        let _ = write!(s, r#"<line x1="{}" y1="{}" x2="{}" y2="{}" stroke="{}" stroke-opacity="0.25"/>"#, n(cx), n(cy), n(p.0), n(p.1), tc);
        if let Some(name) = r.categories.get(i) {
            let q = {
                let ang = -FRAC_PI_2 + TAU * i as f64 / nn as f64;
                (cx + (rad + fs * 1.0) * ang.cos(), cy + (rad + fs * 1.0) * ang.sin())
            };
            let anchor = if (q.0 - cx).abs() < fs { "middle" } else if q.0 > cx { "start" } else { "end" };
            text_at(s, q.0, q.1 + fs * 0.35, anchor, tc, false, fs, name);
        }
    }
    // Value labels up the first spoke.
    for k in 0..=ticks {
        let q = spoke(0, k as f64 / ticks as f64);
        text_at(s, q.0 - fs * 0.3, q.1 + fs * 0.3, "end", tc, false, fs * 0.8, &label(vmin + step * k as f64));
    }
    for (si, x) in r.series.iter().take(50).enumerate() {
        let c = esc(&ink.color(si, &x.color));
        let pts: Vec<(f64, f64)> = (0..nn).map(|i| spoke(i, ((x.values.get(i).copied().filter(|v| v.is_finite()).unwrap_or(vmin) - vmin) / span).clamp(0.0, 1.2))).collect();
        let path: String = pts.iter().enumerate().map(|(i, p)| format!("{}{} {}", if i == 0 { "M" } else { " L" }, n(p.0), n(p.1))).collect();
        if filled {
            let _ = write!(s, r#"<path d="{} Z" fill="{}" fill-opacity="0.55" stroke="{}" stroke-width="{}"/>"#, path, c, c, n(fs * 0.1));
        } else {
            let _ = write!(s, r#"<path d="{} Z" fill="none" stroke="{}" stroke-width="{}" stroke-linejoin="round"/>"#, path, c, n(fs * 0.2));
            for p in &pts {
                let _ = write!(s, r#"<circle cx="{}" cy="{}" r="{}" fill="{}"/>"#, n(p.0), n(p.1), n(fs * 0.28), c);
            }
        }
        if r.data_labels {
            for (i, p) in pts.iter().enumerate() {
                if let Some(v) = x.values.get(i).filter(|v| v.is_finite()) {
                    text_at(s, p.0, p.1 - fs * 0.5, "middle", tc, false, fs * 0.85, &label(*v));
                }
            }
        }
    }
}

/// Surface (seen from above, as Excel's contour form): one row per series, one column per category,
/// each cell coloured by the value band it falls in, with the band scale on the right.
pub(crate) fn surface(s: &mut String, r: &ChartReq, ink: &Ink, a: Area) {
    let fs = ink.fs;
    let nser = r.series.len().min(50);
    let ncat = r.categories.len().max(r.series.iter().map(|x| x.values.len()).max().unwrap_or(0)).min(500);
    if nser == 0 || ncat == 0 {
        return;
    }
    let all: Vec<f64> = r.series.iter().flat_map(|x| x.values.iter().copied()).filter(|v| v.is_finite()).collect();
    if all.is_empty() {
        return;
    }
    let (lo, hi) = all.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(l, h), v| (l.min(*v), h.max(*v)));
    let (vmin, vmax, step) = nice_axis(lo, hi, 6);
    let bands = (((vmax - vmin) / step).round() as usize).clamp(1, 20);
    let name_w = r.series.iter().take(nser).map(|x| tw(&x.name, fs)).fold(0.0, f64::max) + fs * 0.6;
    let legend_w = tw(&format!("{} - {}", label(vmax), label(vmax)), fs * 0.9) + fs * 2.2;
    let (px0, px1) = (a.x0 + name_w.min(a.w() * 0.25), a.x1 - legend_w);
    let (py0, py1) = (a.y0 + fs * 0.4, a.y1 - fs * 1.6);
    let (cw, ch) = ((px1 - px0).max(1.0) / ncat as f64, (py1 - py0).max(1.0) / nser as f64);
    let band_of = |v: f64| (((v - vmin) / step).floor() as usize).min(bands - 1);
    for (si, x) in r.series.iter().take(nser).enumerate() {
        for ci in 0..ncat {
            let Some(v) = x.values.get(ci).copied().filter(|v| v.is_finite()) else { continue };
            let _ = write!(s, r##"<rect x="{}" y="{}" width="{}" height="{}" fill="{}" stroke="#ffffff" stroke-opacity="0.5" stroke-width="{}"/>"##, n(px0 + cw * ci as f64), n(py0 + ch * si as f64), n(cw), n(ch), esc(&ink.palette(band_of(v))), n(fs * 0.05));
            if r.data_labels {
                text_at(s, px0 + cw * (ci as f64 + 0.5), py0 + ch * (si as f64 + 0.5) + fs * 0.3, "middle", "#ffffff", false, fs * 0.85, &label(v));
            }
        }
        text_at(s, px0 - fs * 0.3, py0 + ch * (si as f64 + 0.5) + fs * 0.35, "end", &ink.tc, false, fs, &fit(&x.name, name_w, fs));
    }
    let every = ((tw("0000", fs) / cw.max(1.0)).ceil() as usize).max(1);
    for ci in (0..ncat).step_by(every) {
        text_at(s, px0 + cw * (ci as f64 + 0.5), py1 + fs * 1.2, "middle", &ink.tc, false, fs, r.categories.get(ci).map(String::as_str).unwrap_or(""));
    }
    // The scale: top band first.
    for b in (0..bands).rev() {
        let y = py0 + (bands - 1 - b) as f64 * (fs * 1.4);
        let _ = write!(s, r#"<rect x="{}" y="{}" width="{}" height="{}" fill="{}"/>"#, n(px1 + fs * 0.6), n(y), n(fs * 0.8), n(fs * 0.8), esc(&ink.palette(b)));
        text_at(s, px1 + fs * 1.6, y + fs * 0.75, "start", &ink.tc, false, fs * 0.9, &format!("{} - {}", label(vmin + step * b as f64), label(vmin + step * (b + 1) as f64)));
    }
}
