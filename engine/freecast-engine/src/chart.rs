//! Insert › Chart: column, stacked column, bar, line, area, pie, doughnut and scatter charts drawn as
//! SVG, coloured from the theme accents (as DeckCraft's charts are) unless a series has its own.

use std::fmt::Write;

use deckcraft_color::SchemeSlot;
use serde::Deserialize;
use serde_json::json;

use crate::color::{hex, scheme_named};
use crate::{Res, fin};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Series {
    pub name: String,
    pub values: Vec<f64>,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartReq {
    /// column | columnStacked | bar | barStacked | line | area | pie | doughnut | scatter
    pub kind: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub series: Vec<Series>,
    pub w: f64,
    pub h: f64,
    #[serde(default = "yes")]
    pub legend: bool,
    #[serde(default)]
    pub data_labels: bool,
    #[serde(default)]
    pub scheme: Option<String>,
    /// Text and axis colour.
    #[serde(default = "white")]
    pub text_color: String,
    #[serde(default)]
    pub font_family: String,
    /// Label text size in canvas pixels.
    #[serde(default)]
    pub font_size: f64,
}

fn yes() -> bool {
    true
}
fn white() -> String {
    "#ffffff".into()
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn n(v: f64) -> String {
    let r = (fin(v, 0.0) * 10.0).round() / 10.0;
    if r == r.trunc() { format!("{}", r as i64) } else { format!("{r}") }
}

fn label(v: f64) -> String {
    if !v.is_finite() {
        return String::new();
    }
    if (v - v.round()).abs() < 1e-9 { format!("{}", v.round() as i64) } else { format!("{:.1}", v) }
}

/// A "nice" axis: (min, max, step) covering `lo..hi` with about `ticks` steps of 1, 2 or 5 × 10ⁿ.
pub fn nice_axis(lo: f64, hi: f64, ticks: usize) -> (f64, f64, f64) {
    let (lo, hi) = (fin(lo, 0.0), fin(hi, 1.0));
    let (lo, hi) = if (hi - lo).abs() < 1e-12 { (lo.min(0.0), if hi == 0.0 { 1.0 } else { hi.max(0.0) * 1.0 + 1e-9 }) } else { (lo, hi) };
    let span = (hi - lo).abs().max(1e-9);
    let raw = span / ticks.max(1) as f64;
    let mag = 10f64.powf(raw.log10().floor());
    let step = [1.0, 2.0, 2.5, 5.0, 10.0].iter().map(|m| m * mag).find(|s| *s >= raw).unwrap_or(10.0 * mag);
    let min = (lo / step).floor() * step;
    let max = (hi / step).ceil() * step;
    (min, if max - min < step { min + step } else { max }, step)
}

/// `{svg}`: the chart as a standalone SVG document `w`×`h`.
pub fn svg(r: ChartReq) -> Res {
    let (w, h) = (fin(r.w, 400.0).clamp(10.0, 20_000.0), fin(r.h, 300.0).clamp(10.0, 20_000.0));
    let scheme = scheme_named(r.scheme.as_deref());
    let accents = [SchemeSlot::Accent1, SchemeSlot::Accent2, SchemeSlot::Accent3, SchemeSlot::Accent4, SchemeSlot::Accent5, SchemeSlot::Accent6];
    let color = |i: usize, own: &Option<String>| own.clone().unwrap_or_else(|| hex(scheme.get(accents[i % 6])));
    let fs = if r.font_size > 0.0 { r.font_size } else { (h / 22.0).clamp(10.0, 48.0) };
    let tc = esc(&r.text_color);
    let font = if r.font_family.is_empty() { "sans-serif".to_string() } else { esc(&r.font_family) };
    let series: Vec<&Series> = r.series.iter().take(50).collect();
    let ncat = r.categories.len().max(series.iter().map(|s| s.values.len()).max().unwrap_or(0)).min(500);
    let mut s = String::new();
    let _ = write!(s, r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {} {}" width="{}" height="{}" font-family="{}" font-size="{}" fill="{}">"#, n(w), n(h), n(w), n(h), font, n(fs), tc);
    let mut top = fs * 0.6;
    if !r.title.is_empty() {
        let _ = write!(s, r#"<text x="{}" y="{}" text-anchor="middle" font-size="{}" font-weight="600">{}</text>"#, n(w / 2.0), n(fs * 1.5), n(fs * 1.35), esc(&r.title));
        top = fs * 2.6;
    }
    let pie = matches!(r.kind.as_str(), "pie" | "doughnut");
    // Legend: one row at the bottom (pies list categories, others series).
    let legend_items: Vec<(String, String)> = if pie {
        (0..ncat).map(|i| (r.categories.get(i).cloned().unwrap_or_default(), color(i, &None))).collect()
    } else {
        series.iter().enumerate().map(|(i, x)| (x.name.clone(), color(i, &x.color))).collect()
    };
    let bottom_legend = if r.legend && !legend_items.is_empty() { fs * 2.0 } else { 0.0 };
    if bottom_legend > 0.0 {
        let item_w: Vec<f64> = legend_items.iter().map(|(l, _)| fs * 1.4 + l.chars().count() as f64 * fs * 0.62 + fs).collect();
        let total: f64 = item_w.iter().sum();
        let mut x = ((w - total) / 2.0).max(4.0);
        let y = h - fs * 0.9;
        for ((l, c), iw) in legend_items.iter().zip(&item_w) {
            let _ = write!(s, r#"<rect x="{}" y="{}" width="{}" height="{}" fill="{}"/><text x="{}" y="{}">{}</text>"#, n(x), n(y - fs * 0.75), n(fs * 0.8), n(fs * 0.8), esc(c), n(x + fs * 1.1), n(y), esc(l));
            x += iw;
        }
    }
    let plot_bottom = h - bottom_legend - fs * 0.4;
    if pie {
        let vals: Vec<f64> = (0..ncat).map(|i| series.first().and_then(|x| x.values.get(i)).map(|v| fin(*v, 0.0).max(0.0)).unwrap_or(0.0)).collect();
        let sum: f64 = vals.iter().sum();
        let cx = w / 2.0;
        let cy = (top + plot_bottom) / 2.0;
        let rad = ((plot_bottom - top) / 2.0).min(w / 2.0 - fs).max(1.0);
        let inner = if r.kind == "doughnut" { rad * 0.5 } else { 0.0 };
        let mut a0 = -std::f64::consts::FRAC_PI_2;
        for (i, v) in vals.iter().enumerate() {
            if sum <= 0.0 || *v <= 0.0 {
                continue;
            }
            let frac = v / sum;
            let a1 = a0 + frac * std::f64::consts::TAU;
            let large = if a1 - a0 > std::f64::consts::PI { 1 } else { 0 };
            let (x0, y0, x1, y1) = (cx + rad * a0.cos(), cy + rad * a0.sin(), cx + rad * a1.cos(), cy + rad * a1.sin());
            let c = color(i, &None);
            if frac >= 0.9999 {
                // One slice is the whole pie (a ring for a doughnut: the hole cut out even-odd).
                let ring = |rr: f64| format!("M{} {} a{} {} 0 1 0 {} 0 a{} {} 0 1 0 {} 0 Z", n(cx - rr), n(cy), n(rr), n(rr), n(2.0 * rr), n(rr), n(rr), n(-2.0 * rr));
                let hole = if inner > 0.0 { ring(inner) } else { String::new() };
                let _ = write!(s, r#"<path d="{} {}" fill="{}" fill-rule="evenodd"/>"#, ring(rad), hole, esc(&c));
            } else if inner > 0.0 {
                let (ix0, iy0, ix1, iy1) = (cx + inner * a0.cos(), cy + inner * a0.sin(), cx + inner * a1.cos(), cy + inner * a1.sin());
                let _ = write!(
                    s,
                    r#"<path d="M{} {} A{} {} 0 {} 1 {} {} L{} {} A{} {} 0 {} 0 {} {} Z" fill="{}" stroke="{}" stroke-width="{}"/>"#,
                    n(x0), n(y0), n(rad), n(rad), large, n(x1), n(y1), n(ix1), n(iy1), n(inner), n(inner), large, n(ix0), n(iy0), esc(&c), "#ffffff", n(fs * 0.12)
                );
            } else {
                let _ = write!(
                    s,
                    r#"<path d="M{} {} L{} {} A{} {} 0 {} 1 {} {} Z" fill="{}" stroke="{}" stroke-width="{}"/>"#,
                    n(cx), n(cy), n(x0), n(y0), n(rad), n(rad), large, n(x1), n(y1), esc(&c), "#ffffff", n(fs * 0.12)
                );
            }
            if r.data_labels {
                let am = (a0 + a1) / 2.0;
                let lr = if inner > 0.0 { (rad + inner) / 2.0 } else { rad * 0.65 };
                let _ = write!(s, r#"<text x="{}" y="{}" text-anchor="middle" fill="white" font-weight="600">{}%</text>"#, n(cx + lr * am.cos()), n(cy + lr * am.sin() + fs * 0.35), (frac * 100.0).round());
            }
            a0 = a1;
        }
        s.push_str("</svg>");
        return Ok(json!({ "svg": s }));
    }
    let horizontal = r.kind.starts_with("bar");
    let stacked = r.kind.ends_with("Stacked");
    let scatter = r.kind == "scatter";
    // Value range.
    let mut lo = 0.0f64;
    let mut hi = 0.0f64;
    if stacked {
        for i in 0..ncat {
            let (mut pos, mut neg) = (0.0, 0.0);
            for x in &series {
                let v = x.values.get(i).map(|v| fin(*v, 0.0)).unwrap_or(0.0);
                if v >= 0.0 { pos += v } else { neg += v }
            }
            hi = hi.max(pos);
            lo = lo.min(neg);
        }
    } else {
        for x in &series {
            for v in x.values.iter().take(ncat) {
                let v = fin(*v, 0.0);
                hi = hi.max(v);
                lo = lo.min(v);
            }
        }
    }
    let (vmin, vmax, step) = nice_axis(lo, hi, 5);
    let label_w = [vmin, vmax].iter().map(|v| label(*v).len()).max().unwrap_or(1) as f64 * fs * 0.62 + fs * 0.6;
    let cat_label_w = r.categories.iter().map(|c| c.chars().count()).max().unwrap_or(1) as f64 * fs * 0.62 + fs * 0.6;
    let (left, right, ptop, pbottom) = if horizontal {
        (cat_label_w.min(w * 0.35), w - fs, top + fs * 0.4, plot_bottom - fs * 1.6)
    } else {
        (label_w, w - fs, top + fs * 0.4, plot_bottom - fs * 1.6)
    };
    let (pw, ph) = ((right - left).max(1.0), (pbottom - ptop).max(1.0));
    let val_pos = |v: f64| -> f64 {
        let t = (v - vmin) / (vmax - vmin).max(1e-12);
        if horizontal { left + t * pw } else { pbottom - t * ph }
    };
    // Grid and value labels.
    let mut v = vmin;
    let mut guard = 0;
    while v <= vmax + step * 0.01 && guard < 100 {
        let p = val_pos(v);
        if horizontal {
            let _ = write!(s, r#"<line x1="{}" y1="{}" x2="{}" y2="{}" stroke="{}" stroke-opacity="0.25"/><text x="{}" y="{}" text-anchor="middle">{}</text>"#, n(p), n(ptop), n(p), n(pbottom), tc, n(p), n(pbottom + fs * 1.2), label(v));
        } else {
            let _ = write!(s, r#"<line x1="{}" y1="{}" x2="{}" y2="{}" stroke="{}" stroke-opacity="0.25"/><text x="{}" y="{}" text-anchor="end">{}</text>"#, n(left), n(p), n(right), n(p), tc, n(left - fs * 0.3), n(p + fs * 0.35), label(v));
        }
        v += step;
        guard += 1;
    }
    let ncat_f = ncat.max(1) as f64;
    let band = if horizontal { ph / ncat_f } else { pw / ncat_f };
    let cat_center = |i: usize| -> f64 { if horizontal { ptop + band * (i as f64 + 0.5) } else { left + band * (i as f64 + 0.5) } };
    for i in 0..ncat {
        let c = cat_center(i);
        let text = esc(r.categories.get(i).map(String::as_str).unwrap_or(""));
        if horizontal {
            let _ = write!(s, r#"<text x="{}" y="{}" text-anchor="end">{}</text>"#, n(left - fs * 0.3), n(c + fs * 0.35), text);
        } else {
            let _ = write!(s, r#"<text x="{}" y="{}" text-anchor="middle">{}</text>"#, n(c), n(pbottom + fs * 1.2), text);
        }
    }
    let zero = val_pos(0.0f64.clamp(vmin, vmax));
    let _ = if horizontal {
        write!(s, r#"<line x1="{}" y1="{}" x2="{}" y2="{}" stroke="{}" stroke-opacity="0.6"/>"#, n(zero), n(ptop), n(zero), n(pbottom), tc)
    } else {
        write!(s, r#"<line x1="{}" y1="{}" x2="{}" y2="{}" stroke="{}" stroke-opacity="0.6"/>"#, n(left), n(zero), n(right), n(zero), tc)
    };
    let ns = series.len().max(1) as f64;
    match r.kind.as_str() {
        "line" | "area" | "scatter" => {
            for (si, x) in series.iter().enumerate() {
                let c = esc(&color(si, &x.color));
                let pts: Vec<(f64, f64)> = (0..ncat).filter_map(|i| x.values.get(i).map(|v| (cat_center(i), val_pos(fin(*v, 0.0))))).collect();
                if pts.is_empty() {
                    continue;
                }
                let line: String = pts.iter().enumerate().map(|(k, p)| format!("{}{} {}", if k == 0 { "M" } else { " L" }, n(p.0), n(p.1))).collect();
                if r.kind == "area" {
                    let (first, last) = (pts[0], pts[pts.len() - 1]);
                    let _ = write!(s, r#"<path d="{} L{} {} L{} {} Z" fill="{}" fill-opacity="0.55"/>"#, line, n(last.0), n(zero), n(first.0), n(zero), c);
                }
                if !scatter {
                    let _ = write!(s, r#"<path d="{}" fill="none" stroke="{}" stroke-width="{}" stroke-linejoin="round"/>"#, line, c, n(fs * 0.22));
                }
                if r.kind != "area" {
                    for p in &pts {
                        let _ = write!(s, r#"<circle cx="{}" cy="{}" r="{}" fill="{}"/>"#, n(p.0), n(p.1), n(fs * 0.3), c);
                    }
                }
                if r.data_labels {
                    for (k, p) in pts.iter().enumerate() {
                        let _ = write!(s, r#"<text x="{}" y="{}" text-anchor="middle">{}</text>"#, n(p.0), n(p.1 - fs * 0.6), label(x.values.get(k).copied().unwrap_or(0.0)));
                    }
                }
            }
        }
        _ => {
            let gap = band * 0.25;
            let inner = band - gap;
            for i in 0..ncat {
                let (mut pos_acc, mut neg_acc) = (0.0, 0.0);
                for (si, x) in series.iter().enumerate() {
                    let val = x.values.get(i).map(|v| fin(*v, 0.0)).unwrap_or(0.0);
                    let c = esc(&color(si, &x.color));
                    let (from, to) = if stacked {
                        if val >= 0.0 {
                            pos_acc += val;
                            (pos_acc - val, pos_acc)
                        } else {
                            neg_acc += val;
                            (neg_acc - val, neg_acc)
                        }
                    } else {
                        (0.0, val)
                    };
                    let (a, b) = (val_pos(from), val_pos(to));
                    let (lo_p, size) = (a.min(b), (a - b).abs());
                    let slot = if stacked { inner } else { inner / ns };
                    let off = cat_center(i) - inner / 2.0 + if stacked { 0.0 } else { slot * si as f64 };
                    let _ = if horizontal {
                        write!(s, r#"<rect x="{}" y="{}" width="{}" height="{}" fill="{}"/>"#, n(lo_p), n(off), n(size), n(slot), c)
                    } else {
                        write!(s, r#"<rect x="{}" y="{}" width="{}" height="{}" fill="{}"/>"#, n(off), n(lo_p), n(slot), n(size), c)
                    };
                    if r.data_labels && val != 0.0 {
                        let _ = if horizontal {
                            write!(s, r#"<text x="{}" y="{}">{}</text>"#, n(lo_p + size + fs * 0.25), n(off + slot / 2.0 + fs * 0.35), label(val))
                        } else {
                            write!(s, r#"<text x="{}" y="{}" text-anchor="middle">{}</text>"#, n(off + slot / 2.0), n(lo_p - fs * 0.3), label(val))
                        };
                    }
                }
            }
        }
    }
    s.push_str("</svg>");
    Ok(json!({ "svg": s }))
}
