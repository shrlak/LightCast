//! Insert › Chart drawn as SVG, coloured from the theme accents (as DeckCraft's charts are) unless a
//! series has its own colour. The plain types (column, bar, line, area, pie, doughnut, scatter, with
//! their stacked and 100 % forms), bubble, combo, stock and the Office 2016 types (waterfall,
//! histogram, Pareto, box and whisker, funnel, treemap, sunburst) plus radar and surface. The data
//! logic (bins, quartiles, hierarchy, running totals) is DeckCraft's own, from `deckcraft-model`.

use std::fmt::Write;

use deckcraft_color::{ColorScheme, ColorTransform, Rgba, SchemeSlot, apply};
use deckcraft_model::chart as dm;
use serde::Deserialize;
use serde_json::json;

use crate::chart_ex;
use crate::color::{hex, scheme_named};
use crate::{Res, fin};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Series {
    pub name: String,
    pub values: Vec<f64>,
    #[serde(default)]
    pub color: Option<String>,
    /// Combo charts: this series' own type (column | line | lineMarkers | area).
    #[serde(default)]
    pub kind: Option<String>,
    /// Combo charts: the series reads the secondary value axis on the right.
    #[serde(default)]
    pub secondary_axis: bool,
    /// Scatter and bubble: the x values (without them the points are numbered 1, 2, 3...).
    #[serde(default)]
    pub x_values: Vec<f64>,
    /// Bubble: the bubble sizes.
    #[serde(default)]
    pub sizes: Vec<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartReq {
    /// column | columnStacked | columnPercent | bar | barStacked | barPercent | line | lineMarkers |
    /// lineStacked | area | areaStacked | pie | doughnut | scatter | bubble | radar | radarFilled |
    /// stock | surface | histogram | pareto | boxWhisker | waterfall | funnel | treemap | sunburst | combo
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
    #[serde(default = "yes")]
    pub gridlines: bool,
    #[serde(default)]
    pub scheme: Option<String>,
    /// `colorful` (the accents in turn) or `monochrome1`..`monochrome6` (shades of one accent).
    #[serde(default)]
    pub palette: String,
    /// Text and axis colour.
    #[serde(default = "white")]
    pub text_color: String,
    #[serde(default)]
    pub font_family: String,
    /// Label text size in canvas pixels.
    #[serde(default)]
    pub font_size: f64,
    /// Waterfall: the points that are totals (they stand on the axis and restart the running total).
    #[serde(default)]
    pub subtotals: Vec<usize>,
    /// Histogram and Pareto: a bin count or a bin width (a width wins when both are given).
    #[serde(default)]
    pub bin_count: Option<u32>,
    #[serde(default)]
    pub bin_size: Option<f64>,
    /// Box and whisker: quartiles by QUARTILE.INC instead of QUARTILE.EXC.
    #[serde(default)]
    pub inclusive_quartiles: bool,
    /// Treemap and sunburst: outer category levels, innermost first (the leaves' parents, then theirs).
    #[serde(default)]
    pub category_levels: Vec<Vec<String>>,
    /// Stock: open-high-low-close boxes between the first and last series.
    #[serde(default)]
    pub up_down_bars: bool,
}

fn yes() -> bool {
    true
}
fn white() -> String {
    "#ffffff".into()
}

pub(crate) fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

pub(crate) fn n(v: f64) -> String {
    let r = (fin(v, 0.0) * 10.0).round() / 10.0;
    if r == r.trunc() { format!("{}", r as i64) } else { format!("{r}") }
}

pub(crate) fn label(v: f64) -> String {
    if !v.is_finite() {
        return String::new();
    }
    if (v - v.round()).abs() < 1e-9 { format!("{}", v.round() as i64) } else { format!("{:.1}", v) }
}

/// Width of `text` at `fs` (Hangul and other wide glyphs are a full em, Latin about 0.58).
pub(crate) fn tw(text: &str, fs: f64) -> f64 {
    text.chars().map(|c| if c.is_ascii() { 0.58 } else { 1.0 }).sum::<f64>() * fs
}

/// `text` cut with an ellipsis so it fits `max` wide at `fs` (empty when not even one glyph fits).
pub(crate) fn fit(text: &str, max: f64, fs: f64) -> String {
    if tw(text, fs) <= max {
        return text.to_string();
    }
    let mut out = String::new();
    for c in text.chars() {
        if tw(&format!("{out}{c}…"), fs) > max {
            break;
        }
        out.push(c);
    }
    if out.is_empty() { String::new() } else { format!("{out}…") }
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

/// Every chart type the engine draws.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Column,
    ColumnStacked,
    ColumnPercent,
    Bar,
    BarStacked,
    BarPercent,
    Line,
    LineMarkers,
    LineStacked,
    Area,
    AreaStacked,
    Pie,
    Doughnut,
    Scatter,
    Bubble,
    Radar,
    RadarFilled,
    Stock,
    Surface,
    Histogram,
    Pareto,
    BoxWhisker,
    Waterfall,
    Funnel,
    Treemap,
    Sunburst,
    Combo,
}

pub fn parse_kind(s: &str) -> Kind {
    match s {
        "columnStacked" => Kind::ColumnStacked,
        "columnPercent" => Kind::ColumnPercent,
        "bar" => Kind::Bar,
        "barStacked" => Kind::BarStacked,
        "barPercent" => Kind::BarPercent,
        "line" => Kind::Line,
        "lineMarkers" => Kind::LineMarkers,
        "lineStacked" => Kind::LineStacked,
        "area" => Kind::Area,
        "areaStacked" => Kind::AreaStacked,
        "pie" => Kind::Pie,
        "doughnut" => Kind::Doughnut,
        "scatter" => Kind::Scatter,
        "bubble" => Kind::Bubble,
        "radar" => Kind::Radar,
        "radarFilled" => Kind::RadarFilled,
        "stock" => Kind::Stock,
        "surface" => Kind::Surface,
        "histogram" => Kind::Histogram,
        "pareto" => Kind::Pareto,
        "boxWhisker" => Kind::BoxWhisker,
        "waterfall" => Kind::Waterfall,
        "funnel" => Kind::Funnel,
        "treemap" => Kind::Treemap,
        "sunburst" => Kind::Sunburst,
        "combo" => Kind::Combo,
        _ => Kind::Column,
    }
}

/// Colours and text settings shared by every drawer.
pub(crate) struct Ink {
    pub fs: f64,
    pub tc: String,
    pub font: String,
    scheme: ColorScheme,
    palette: String,
}

impl Ink {
    /// Colour of series/point `i`: the accents in turn, then darker and lighter rounds (DeckCraft's
    /// `series_color`); a monochrome palette walks the rounds of a single accent.
    pub fn palette(&self, i: usize) -> String {
        const SLOTS: [SchemeSlot; 6] = [SchemeSlot::Accent1, SchemeSlot::Accent2, SchemeSlot::Accent3, SchemeSlot::Accent4, SchemeSlot::Accent5, SchemeSlot::Accent6];
        let mono = self.palette.starts_with("monochrome");
        let accent = if mono { self.palette["monochrome".len()..].parse::<usize>().ok().filter(|k| (1..=6).contains(k)).map_or(0, |k| k - 1) } else { i % 6 };
        let base: Rgba = self.scheme.get(SLOTS[accent]);
        let round = if mono { i } else { i / 6 };
        hex(match round {
            0 => base,
            1 => apply(base, &[ColorTransform::Shade(60000)]),
            2 => apply(base, &[ColorTransform::Tint(60000)]),
            k => apply(base, &[ColorTransform::LumMod(100000 - (k as i32 % 5) * 12000)]),
        })
    }
    pub fn color(&self, i: usize, own: &Option<String>) -> String {
        own.clone().unwrap_or_else(|| self.palette(i))
    }
}

/// The free rectangle left by the title and legend.
#[derive(Clone, Copy)]
pub(crate) struct Area {
    pub x0: f64,
    pub y0: f64,
    pub x1: f64,
    pub y1: f64,
}
impl Area {
    pub fn w(&self) -> f64 {
        self.x1 - self.x0
    }
    pub fn h(&self) -> f64 {
        self.y1 - self.y0
    }
}

/// How a cartesian series is drawn.
#[derive(Clone, Copy, PartialEq)]
enum Sk {
    Bar,
    Line,
    LineMarkers,
    Area,
    Scatter,
    Bubble,
}

struct Ser {
    color: String,
    vals: Vec<Option<f64>>,
    kind: Sk,
    secondary: bool,
    xs: Vec<f64>,
    sizes: Vec<f64>,
}

enum Special {
    None,
    /// (from, to, role) per bar: role 0 increase, 1 decrease, 2 total.
    Waterfall(Vec<(f64, f64, usize)>),
    Boxes(Vec<Vec<Option<dm::BoxStats>>>),
    Stock,
}

struct Cart {
    cats: Vec<String>,
    sers: Vec<Ser>,
    horizontal: bool,
    stack_bars: bool,
    stack_lines: bool,
    /// Axis labels carry a "%" (100 % stacks, the Pareto line).
    pct: bool,
    pct2: bool,
    gap: f64,
    special: Special,
}

pub(crate) fn model_chart(r: &ChartReq, kind: dm::ChartType) -> dm::Chart {
    dm::Chart {
        kind,
        categories: r.categories.clone(),
        series: r
            .series
            .iter()
            .map(|s| dm::Series { name: s.name.clone(), values: s.values.iter().map(|v| v.is_finite().then_some(*v)).collect(), ..Default::default() })
            .collect(),
        subtotals: r.subtotals.clone(),
        bin_count: r.bin_count,
        bin_size: r.bin_size,
        inclusive_quartiles: r.inclusive_quartiles,
        category_levels: r.category_levels.clone(),
        ..Default::default()
    }
}

/// Bin labels as Excel writes them: `[lo, hi]` for the first bin, `(lo, hi]` after it.
fn bin_label(b: &dm::Bin, first: bool) -> String {
    let f = |v: f64| {
        let r = (v * 100.0).round() / 100.0;
        if (r - r.round()).abs() < 1e-9 { format!("{}", r.round() as i64) } else { format!("{r}") }
    };
    if first { format!("[{}, {}]", f(b.lo), f(b.hi)) } else { format!("({}, {}]", f(b.lo), f(b.hi)) }
}

/// The histogram's bins (Pareto: sorted by count) of the first series, with their labels.
pub fn bins_of(r: &ChartReq, pareto: bool) -> Vec<(String, dm::Bin)> {
    let mut bins = model_chart(r, dm::ChartType::Histogram).histogram_bins();
    let first_lo = bins.iter().map(|b| b.lo).fold(f64::INFINITY, f64::min);
    if pareto {
        bins.sort_by_key(|b| std::cmp::Reverse(b.count));
    }
    bins.into_iter().map(|b| (bin_label(&b, b.lo <= first_lo), b)).collect()
}

/// `{svg}`: the chart as a standalone SVG document `w`×`h`.
pub fn svg(r: ChartReq) -> Res {
    let (w, h) = (fin(r.w, 400.0).clamp(10.0, 20_000.0), fin(r.h, 300.0).clamp(10.0, 20_000.0));
    let kind = parse_kind(&r.kind);
    let fs = if r.font_size > 0.0 { r.font_size } else { (h / 22.0).clamp(10.0, 48.0) };
    let ink = Ink {
        fs,
        tc: esc(&r.text_color),
        font: if r.font_family.is_empty() { "sans-serif".to_string() } else { esc(&r.font_family) },
        scheme: scheme_named(r.scheme.as_deref()),
        palette: r.palette.clone(),
    };
    let series: Vec<&Series> = r.series.iter().take(50).collect();
    let ncat = r.categories.len().max(series.iter().map(|s| s.values.len()).max().unwrap_or(0)).min(500);
    let mut s = String::new();
    let _ = write!(s, r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {} {}" width="{}" height="{}" font-family="{}" font-size="{}" fill="{}">"#, n(w), n(h), n(w), n(h), ink.font, n(fs), ink.tc);
    let mut top = fs * 0.6;
    if !r.title.is_empty() {
        let _ = write!(s, r#"<text x="{}" y="{}" text-anchor="middle" font-size="{}" font-weight="600">{}</text>"#, n(w / 2.0), n(fs * 1.5), n(fs * 1.35), esc(&r.title));
        top = fs * 2.6;
    }
    let pie_like = matches!(kind, Kind::Pie | Kind::Doughnut);
    // Legend: one row at the bottom (pies list categories, hierarchies their top groups, others series).
    let legend_items: Vec<(String, String)> = match kind {
        Kind::Pie | Kind::Doughnut => (0..ncat).map(|i| (r.categories.get(i).cloned().unwrap_or_default(), ink.palette(i))).collect(),
        Kind::Treemap | Kind::Sunburst => model_chart(&r, dm::ChartType::Treemap).category_tree().iter().enumerate().map(|(i, t)| (t.name.clone(), ink.palette(i))).collect(),
        Kind::Waterfall => ["증가", "감소", "합계"].iter().enumerate().map(|(i, t)| (t.to_string(), ink.palette(i))).collect(),
        Kind::Funnel | Kind::Surface => vec![],
        Kind::Pareto => vec![(series.first().map(|x| x.name.clone()).unwrap_or_default(), ink.color(0, &series.first().and_then(|x| x.color.clone()))), ("누적 %".to_string(), ink.palette(1))],
        _ => series.iter().enumerate().map(|(i, x)| (x.name.clone(), ink.color(i, &x.color))).collect(),
    };
    let bottom_legend = if r.legend && !legend_items.is_empty() { fs * 2.0 } else { 0.0 };
    if bottom_legend > 0.0 {
        let item_w: Vec<f64> = legend_items.iter().map(|(l, _)| fs * 1.4 + tw(l, fs) + fs).collect();
        let total: f64 = item_w.iter().sum();
        let mut x = ((w - total) / 2.0).max(4.0);
        let y = h - fs * 0.9;
        for ((l, c), iw) in legend_items.iter().zip(&item_w) {
            let _ = write!(s, r#"<rect x="{}" y="{}" width="{}" height="{}" fill="{}"/><text x="{}" y="{}">{}</text>"#, n(x), n(y - fs * 0.75), n(fs * 0.8), n(fs * 0.8), esc(c), n(x + fs * 1.1), n(y), esc(l));
            x += iw;
        }
    }
    let plot_bottom = h - bottom_legend - fs * 0.4;
    if pie_like {
        draw_pie(&mut s, &r, kind, &ink, w, top, plot_bottom, &series, ncat);
        s.push_str("</svg>");
        return Ok(json!({ "svg": s }));
    }
    let area = Area { x0: fs * 0.6, y0: top, x1: w - fs * 0.6, y1: plot_bottom };
    match kind {
        Kind::Funnel => chart_ex::funnel(&mut s, &r, &ink, area),
        Kind::Treemap => chart_ex::treemap(&mut s, &r, &ink, area),
        Kind::Sunburst => chart_ex::sunburst(&mut s, &r, &ink, area),
        Kind::Radar | Kind::RadarFilled => chart_ex::radar(&mut s, &r, &ink, area, kind == Kind::RadarFilled),
        Kind::Surface => chart_ex::surface(&mut s, &r, &ink, area),
        _ => {
            let cart = build_cart(&r, kind, &ink);
            draw_cart(&mut s, &r, &ink, area, cart);
        }
    }
    s.push_str("</svg>");
    Ok(json!({ "svg": s }))
}

#[allow(clippy::too_many_arguments)]
fn draw_pie(s: &mut String, r: &ChartReq, kind: Kind, ink: &Ink, w: f64, top: f64, plot_bottom: f64, series: &[&Series], ncat: usize) {
    let fs = ink.fs;
    let vals: Vec<f64> = (0..ncat).map(|i| series.first().and_then(|x| x.values.get(i)).map(|v| fin(*v, 0.0).max(0.0)).unwrap_or(0.0)).collect();
    let sum: f64 = vals.iter().sum();
    let cx = w / 2.0;
    let cy = (top + plot_bottom) / 2.0;
    let rad = ((plot_bottom - top) / 2.0).min(w / 2.0 - fs).max(1.0);
    let inner = if kind == Kind::Doughnut { rad * 0.5 } else { 0.0 };
    let mut a0 = -std::f64::consts::FRAC_PI_2;
    for (i, v) in vals.iter().enumerate() {
        if sum <= 0.0 || *v <= 0.0 {
            continue;
        }
        let frac = v / sum;
        let a1 = a0 + frac * std::f64::consts::TAU;
        let large = if a1 - a0 > std::f64::consts::PI { 1 } else { 0 };
        let (x0, y0, x1, y1) = (cx + rad * a0.cos(), cy + rad * a0.sin(), cx + rad * a1.cos(), cy + rad * a1.sin());
        let c = ink.palette(i);
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
}

/// Turn the request into cartesian series for every type drawn on a value axis.
fn build_cart(r: &ChartReq, kind: Kind, ink: &Ink) -> Cart {
    let opt = |v: &[f64]| -> Vec<Option<f64>> { v.iter().map(|x| x.is_finite().then_some(*x)).collect() };
    let mk = |i: usize, x: &Series, k: Sk| Ser {
        color: ink.color(i, &x.color),
        vals: opt(&x.values),
        kind: k,
        secondary: x.secondary_axis,
        xs: x.x_values.clone(),
        sizes: x.sizes.clone(),
    };
    let series: Vec<&Series> = r.series.iter().take(50).collect();
    let mut cart = Cart { cats: r.categories.clone(), sers: vec![], horizontal: false, stack_bars: false, stack_lines: false, pct: false, pct2: false, gap: 0.25, special: Special::None };
    let per_series = |k: Sk| -> Vec<Ser> { series.iter().enumerate().map(|(i, x)| mk(i, x, k)).collect() };
    match kind {
        Kind::Column | Kind::Bar => cart.sers = per_series(Sk::Bar),
        Kind::ColumnStacked | Kind::BarStacked => {
            cart.sers = per_series(Sk::Bar);
            cart.stack_bars = true;
        }
        Kind::ColumnPercent | Kind::BarPercent => {
            cart.sers = per_series(Sk::Bar);
            cart.stack_bars = true;
            cart.pct = true;
            // Each category's bars are shares of its own total, as a percentage.
            let ncat = cart.sers.iter().map(|s| s.vals.len()).max().unwrap_or(0);
            for i in 0..ncat {
                let total: f64 = cart.sers.iter().map(|s| s.vals.get(i).copied().flatten().unwrap_or(0.0).abs()).sum::<f64>().max(1e-9);
                for s in &mut cart.sers {
                    if let Some(v) = s.vals.get_mut(i).and_then(Option::as_mut) {
                        *v = *v / total * 100.0;
                    }
                }
            }
        }
        Kind::Line => cart.sers = per_series(Sk::Line),
        Kind::LineMarkers => cart.sers = per_series(Sk::LineMarkers),
        Kind::LineStacked => {
            cart.sers = per_series(Sk::LineMarkers);
            cart.stack_lines = true;
        }
        Kind::Area => cart.sers = per_series(Sk::Area),
        Kind::AreaStacked => {
            cart.sers = per_series(Sk::Area);
            cart.stack_lines = true;
        }
        Kind::Scatter => cart.sers = per_series(Sk::Scatter),
        Kind::Bubble => cart.sers = per_series(Sk::Bubble),
        Kind::Combo => {
            cart.sers = series
                .iter()
                .enumerate()
                .map(|(i, x)| {
                    let k = match x.kind.as_deref() {
                        Some("line") => Sk::Line,
                        Some("lineMarkers") => Sk::LineMarkers,
                        Some("area") => Sk::Area,
                        _ => Sk::Bar,
                    };
                    mk(i, x, k)
                })
                .collect();
        }
        Kind::Histogram | Kind::Pareto => {
            let pareto = kind == Kind::Pareto;
            let bins = bins_of(r, pareto);
            cart.cats = bins.iter().map(|(l, _)| l.clone()).collect();
            let first = series.first().copied();
            cart.sers.push(Ser {
                color: ink.color(0, &first.and_then(|x| x.color.clone())),
                vals: bins.iter().map(|(_, b)| Some(b.count as f64)).collect(),
                kind: Sk::Bar,
                secondary: false,
                xs: vec![],
                sizes: vec![],
            });
            cart.gap = if pareto { 0.1 } else { 0.0 };
            if pareto {
                let total = bins.iter().map(|(_, b)| b.count).sum::<usize>().max(1) as f64;
                let mut run = 0.0;
                cart.sers.push(Ser {
                    color: ink.palette(1),
                    vals: bins
                        .iter()
                        .map(|(_, b)| {
                            run += b.count as f64;
                            Some(run / total * 100.0)
                        })
                        .collect(),
                    kind: Sk::LineMarkers,
                    secondary: true,
                    xs: vec![],
                    sizes: vec![],
                });
                cart.pct2 = true;
            }
        }
        Kind::Waterfall => {
            let m = model_chart(r, dm::ChartType::Waterfall);
            let bars = m.waterfall_bars();
            let vals: Vec<f64> = series.first().map(|x| x.values.clone()).unwrap_or_default();
            let roles = bars
                .iter()
                .enumerate()
                .map(|(i, (a, b))| (*a, *b, if r.subtotals.contains(&i) { 2 } else if vals.get(i).copied().unwrap_or(0.0) >= 0.0 { 0 } else { 1 }))
                .collect();
            cart.special = Special::Waterfall(roles);
            if let Some(x) = series.first() {
                cart.sers.push(mk(0, x, Sk::Bar));
            }
        }
        Kind::BoxWhisker => {
            let (groups, stats) = model_chart(r, dm::ChartType::BoxWhisker).box_groups();
            cart.cats = groups;
            cart.sers = series.iter().enumerate().map(|(i, x)| Ser { vals: vec![], ..mk(i, x, Sk::Bar) }).collect();
            cart.special = Special::Boxes(stats);
        }
        Kind::Stock => {
            cart.sers = per_series(Sk::Bar);
            cart.special = Special::Stock;
        }
        // Drawn by their own functions; never reach the cartesian drawer.
        Kind::Pie | Kind::Doughnut | Kind::Radar | Kind::RadarFilled | Kind::Surface | Kind::Funnel | Kind::Treemap | Kind::Sunburst => {}
    }
    cart.horizontal = matches!(kind, Kind::Bar | Kind::BarStacked | Kind::BarPercent);
    cart
}

fn fmt_axis(v: f64, pct: bool) -> String {
    if pct { format!("{}%", label(v)) } else { label(v) }
}

fn draw_cart(s: &mut String, r: &ChartReq, ink: &Ink, area: Area, cart: Cart) {
    let fs = ink.fs;
    let tc = &ink.tc;
    let horizontal = cart.horizontal;
    let sers = &cart.sers;
    let ncat = cart.cats.len().max(sers.iter().map(|x| x.vals.len()).max().unwrap_or(0)).max(match &cart.special {
        Special::Boxes(b) => b.first().map_or(0, Vec::len),
        _ => 0,
    });
    let is_xy = sers.iter().any(|x| matches!(x.kind, Sk::Scatter | Sk::Bubble));
    let has_x = sers.iter().any(|x| x.xs.iter().any(|v| v.is_finite()));
    // Value ranges, one per axis.
    let (mut lo, mut hi, mut lo2, mut hi2) = (0.0f64, 0.0f64, 0.0f64, 0.0f64);
    let widen = |sec: bool, v: f64, lo: &mut f64, hi: &mut f64, lo2: &mut f64, hi2: &mut f64| {
        if sec {
            *lo2 = lo2.min(v);
            *hi2 = hi2.max(v);
        } else {
            *lo = lo.min(v);
            *hi = hi.max(v);
        }
    };
    let mut free_floor = false;
    match &cart.special {
        Special::Waterfall(bars) => {
            for (a, b, _) in bars {
                widen(false, *a, &mut lo, &mut hi, &mut lo2, &mut hi2);
                widen(false, *b, &mut lo, &mut hi, &mut lo2, &mut hi2);
            }
        }
        Special::Boxes(stats) => {
            for b in stats.iter().flatten().flatten() {
                let top = b.outliers.iter().copied().fold(b.high, f64::max);
                let low = b.outliers.iter().copied().fold(b.low, f64::min);
                widen(false, top, &mut lo, &mut hi, &mut lo2, &mut hi2);
                widen(false, low, &mut lo, &mut hi, &mut lo2, &mut hi2);
            }
        }
        Special::Stock => {
            // Prices: the axis hugs the data instead of starting at zero.
            free_floor = true;
            lo = f64::INFINITY;
            hi = f64::NEG_INFINITY;
            for x in sers {
                for v in x.vals.iter().flatten() {
                    widen(false, *v, &mut lo, &mut hi, &mut lo2, &mut hi2);
                }
            }
            if !lo.is_finite() {
                (lo, hi) = (0.0, 1.0);
            }
        }
        Special::None => {
            let mut acc_pos = vec![0.0; ncat];
            let mut acc_neg = vec![0.0; ncat];
            let mut line_acc = vec![0.0; ncat];
            for x in sers {
                for (i, v) in x.vals.iter().enumerate().take(ncat) {
                    let Some(v) = *v else { continue };
                    match x.kind {
                        Sk::Bar if cart.stack_bars => {
                            if v >= 0.0 {
                                acc_pos[i] += v;
                                widen(x.secondary, acc_pos[i], &mut lo, &mut hi, &mut lo2, &mut hi2);
                            } else {
                                acc_neg[i] += v;
                                widen(x.secondary, acc_neg[i], &mut lo, &mut hi, &mut lo2, &mut hi2);
                            }
                        }
                        Sk::Line | Sk::LineMarkers | Sk::Area if cart.stack_lines => {
                            line_acc[i] += v;
                            widen(x.secondary, line_acc[i], &mut lo, &mut hi, &mut lo2, &mut hi2);
                        }
                        _ => widen(x.secondary, v, &mut lo, &mut hi, &mut lo2, &mut hi2),
                    }
                }
            }
        }
    }
    let (vmin, vmax, step) = if cart.pct {
        (0.0, 100.0, 20.0)
    } else if free_floor {
        let pad = (hi - lo).abs().max(1e-9) * 0.05;
        nice_axis(lo - pad, hi + pad, 5)
    } else {
        nice_axis(lo, hi, 5)
    };
    let has_sec = sers.iter().any(|x| x.secondary) && !horizontal;
    let (vmin2, vmax2, step2) = if cart.pct2 { (0.0, 100.0, 20.0) } else { nice_axis(lo2, hi2, 5) };
    let label_w = [vmin, vmax].iter().map(|v| fmt_axis(*v, cart.pct).chars().count()).max().unwrap_or(1) as f64 * fs * 0.62 + fs * 0.6;
    let label_w2 = if has_sec { [vmin2, vmax2].iter().map(|v| fmt_axis(*v, cart.pct2).chars().count()).max().unwrap_or(1) as f64 * fs * 0.62 + fs * 0.6 } else { 0.0 };
    let cat_label_w = cart.cats.iter().map(|c| tw(c, fs)).fold(1.0, f64::max) + fs * 0.6;
    let (left, right, ptop, pbottom) = if horizontal {
        (area.x0 + cat_label_w.min(area.w() * 0.35), area.x1 - fs * 0.4, area.y0 + fs * 0.4, area.y1 - fs * 1.6)
    } else {
        (area.x0 + label_w, area.x1 - fs * 0.4 - label_w2, area.y0 + fs * 0.4, area.y1 - fs * 1.6)
    };
    let (pw, ph) = ((right - left).max(1.0), (pbottom - ptop).max(1.0));
    let val_pos = |sec: bool, v: f64| -> f64 {
        let (mn, mx) = if sec { (vmin2, vmax2) } else { (vmin, vmax) };
        let t = (v.clamp(mn, mx) - mn) / (mx - mn).max(1e-12);
        if horizontal { left + t * pw } else { pbottom - t * ph }
    };
    // Gridlines and value labels (the secondary axis' labels stand on the right).
    let grid = |s: &mut String, mn: f64, mx: f64, st: f64, sec: bool, pct: bool| {
        let mut v = mn;
        let mut guard = 0;
        while v <= mx + st * 0.01 && guard < 100 {
            let p = val_pos(sec, v);
            if horizontal {
                if r.gridlines {
                    let _ = write!(s, r#"<line x1="{}" y1="{}" x2="{}" y2="{}" stroke="{}" stroke-opacity="0.25"/>"#, n(p), n(ptop), n(p), n(pbottom), tc);
                }
                let _ = write!(s, r#"<text x="{}" y="{}" text-anchor="middle">{}</text>"#, n(p), n(pbottom + fs * 1.2), fmt_axis(v, pct));
            } else {
                if r.gridlines && !sec {
                    let _ = write!(s, r#"<line x1="{}" y1="{}" x2="{}" y2="{}" stroke="{}" stroke-opacity="0.25"/>"#, n(left), n(p), n(right), n(p), tc);
                }
                if sec {
                    let _ = write!(s, r#"<text x="{}" y="{}">{}</text>"#, n(right + fs * 0.3), n(p + fs * 0.35), fmt_axis(v, pct));
                } else {
                    let _ = write!(s, r#"<text x="{}" y="{}" text-anchor="end">{}</text>"#, n(left - fs * 0.3), n(p + fs * 0.35), fmt_axis(v, pct));
                }
            }
            v += st;
            guard += 1;
        }
    };
    grid(s, vmin, vmax, step, false, cart.pct);
    if has_sec {
        grid(s, vmin2, vmax2, step2, true, cart.pct2);
    }
    // x axis: a value scale for scatter and bubble charts that carry x values, else the categories.
    let xs_all: Vec<f64> = sers.iter().filter(|x| matches!(x.kind, Sk::Scatter | Sk::Bubble)).flat_map(|x| x.xs.iter().copied()).filter(|v| v.is_finite()).collect();
    let x_scale = if is_xy && has_x && !xs_all.is_empty() {
        let (a, b) = xs_all.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), v| (a.min(*v), b.max(*v)));
        Some(nice_axis(a, b, 6))
    } else {
        None
    };
    let ncat_f = ncat.max(1) as f64;
    let band = if horizontal { ph / ncat_f } else { pw / ncat_f };
    let cat_center = |i: usize| -> f64 { if horizontal { ptop + band * (i as f64 + 0.5) } else { left + band * (i as f64 + 0.5) } };
    if let Some((mn, mx, st)) = x_scale {
        let mut v = mn;
        let mut guard = 0;
        while v <= mx + st * 0.01 && guard < 100 {
            let x = left + (v - mn) / (mx - mn).max(1e-12) * pw;
            if r.gridlines {
                let _ = write!(s, r#"<line x1="{}" y1="{}" x2="{}" y2="{}" stroke="{}" stroke-opacity="0.15"/>"#, n(x), n(ptop), n(x), n(pbottom), tc);
            }
            let _ = write!(s, r#"<text x="{}" y="{}" text-anchor="middle">{}</text>"#, n(x), n(pbottom + fs * 1.2), label(v));
            v += st;
            guard += 1;
        }
    } else {
        // Thin the labels when they would overlap.
        let widest = cart.cats.iter().map(|c| tw(c, fs)).fold(0.0, f64::max) + fs * 0.4;
        let every = if horizontal { 1 } else { ((widest / band.max(1.0)).ceil() as usize).max(1) };
        for i in (0..ncat).step_by(every) {
            let c = cat_center(i);
            let text = esc(cart.cats.get(i).map(String::as_str).unwrap_or(""));
            if horizontal {
                let _ = write!(s, r#"<text x="{}" y="{}" text-anchor="end">{}</text>"#, n(left - fs * 0.3), n(c + fs * 0.35), text);
            } else {
                let _ = write!(s, r#"<text x="{}" y="{}" text-anchor="middle">{}</text>"#, n(c), n(pbottom + fs * 1.2), text);
            }
        }
    }
    let zero = val_pos(false, 0.0f64.clamp(vmin, vmax));
    let _ = if horizontal {
        write!(s, r#"<line x1="{}" y1="{}" x2="{}" y2="{}" stroke="{}" stroke-opacity="0.6"/>"#, n(zero), n(ptop), n(zero), n(pbottom), tc)
    } else {
        write!(s, r#"<line x1="{}" y1="{}" x2="{}" y2="{}" stroke="{}" stroke-opacity="0.6"/>"#, n(left), n(zero), n(right), n(zero), tc)
    };
    let pos_x = |x: &Ser, i: usize| -> Option<f64> {
        match x_scale {
            Some((mn, mx, _)) => x.xs.get(i).copied().filter(|v| v.is_finite()).map(|v| left + (v - mn) / (mx - mn).max(1e-12) * pw),
            None => Some(cat_center(i)),
        }
    };
    // Special charts first (their own marks), then bars, areas, lines.
    match &cart.special {
        Special::Boxes(stats) => {
            let ns = stats.len().max(1);
            let group = band * 0.75;
            let bw = group / ns as f64;
            for (si, per) in stats.iter().enumerate() {
                let fill = esc(&sers.get(si).map(|x| x.color.clone()).unwrap_or_default());
                for (gi, st) in per.iter().enumerate() {
                    let Some(st) = st else { continue };
                    let c0 = band * gi as f64 + (band - group) / 2.0 + bw * si as f64 + if horizontal { ptop } else { left };
                    let (a, z) = (c0 + bw * 0.1, c0 + bw * 0.9);
                    let mid = (a + z) / 2.0;
                    let pt = |along: f64, val: f64| if horizontal { (val_pos(false, val), along) } else { (along, val_pos(false, val)) };
                    let (p1, p2) = (pt(a, st.q1), pt(z, st.q3));
                    let (bx, by, bw2, bh) = (p1.0.min(p2.0), p1.1.min(p2.1), (p1.0 - p2.0).abs(), (p1.1 - p2.1).abs());
                    let _ = write!(s, r#"<rect x="{}" y="{}" width="{}" height="{}" fill="{}" fill-opacity="0.85" stroke="{}" stroke-width="{}"/>"#, n(bx), n(by), n(bw2), n(bh), fill, tc, n(fs * 0.08));
                    let mut d = String::new();
                    for (from, to) in [(st.q3, st.high), (st.q1, st.low)] {
                        let (f, t) = (pt(mid, from), pt(mid, to));
                        let (c1, c2) = (pt(mid - bw * 0.2, to), pt(mid + bw * 0.2, to));
                        let _ = write!(d, "M{} {} L{} {} M{} {} L{} {} ", n(f.0), n(f.1), n(t.0), n(t.1), n(c1.0), n(c1.1), n(c2.0), n(c2.1));
                    }
                    let (m1, m2) = (pt(a, st.median), pt(z, st.median));
                    let _ = write!(d, "M{} {} L{} {}", n(m1.0), n(m1.1), n(m2.0), n(m2.1));
                    let _ = write!(s, r#"<path d="{}" fill="none" stroke="{}" stroke-width="{}"/>"#, d, tc, n(fs * 0.1));
                    // The mean as an x, outliers as dots.
                    let (mx_, rr) = (pt(mid, st.mean), (bw * 0.08).clamp(fs * 0.12, fs * 0.35));
                    let _ = write!(s, r#"<path d="M{} {} L{} {} M{} {} L{} {}" stroke="{}" stroke-width="{}" fill="none"/>"#, n(mx_.0 - rr), n(mx_.1 - rr), n(mx_.0 + rr), n(mx_.1 + rr), n(mx_.0 - rr), n(mx_.1 + rr), n(mx_.0 + rr), n(mx_.1 - rr), tc, n(fs * 0.1));
                    for o in &st.outliers {
                        let q = pt(mid, *o);
                        let _ = write!(s, r#"<circle cx="{}" cy="{}" r="{}" fill="{}" stroke="{}" stroke-width="{}"/>"#, n(q.0), n(q.1), n(rr), fill, tc, n(fs * 0.06));
                    }
                }
            }
        }
        Special::Waterfall(bars) => {
            let inner = band * (1.0 - cart.gap);
            let vals: Vec<f64> = sers.first().map(|x| x.vals.iter().map(|v| v.unwrap_or(0.0)).collect()).unwrap_or_default();
            for (i, (a, b, role)) in bars.iter().enumerate() {
                let (pa, pb) = (val_pos(false, *a), val_pos(false, *b));
                let off = cat_center(i) - inner / 2.0;
                let (lo_p, size) = (pa.min(pb), (pa - pb).abs());
                let c = esc(&ink.palette(*role));
                let _ = if horizontal {
                    write!(s, r#"<rect x="{}" y="{}" width="{}" height="{}" fill="{}"/>"#, n(lo_p), n(off), n(size), n(inner), c)
                } else {
                    write!(s, r#"<rect x="{}" y="{}" width="{}" height="{}" fill="{}"/>"#, n(off), n(lo_p), n(inner), n(size), c)
                };
                // The connector from this bar's end to the next bar.
                if i + 1 < bars.len() {
                    let level = val_pos(false, *b);
                    let (x1, x2) = (cat_center(i) + inner / 2.0, cat_center(i + 1) - inner / 2.0);
                    let _ = write!(s, r#"<line x1="{}" y1="{}" x2="{}" y2="{}" stroke="{}" stroke-opacity="0.5" stroke-width="{}"/>"#, n(x1), n(level), n(x2), n(level), tc, n(fs * 0.06));
                }
                if r.data_labels {
                    let v = vals.get(i).copied().unwrap_or(0.0);
                    let _ = write!(s, r#"<text x="{}" y="{}" text-anchor="middle">{}</text>"#, n(off + inner / 2.0), n(lo_p - fs * 0.3), label(v));
                }
            }
        }
        _ => {}
    }
    // Bars.
    let bar_sers: Vec<&Ser> = sers.iter().filter(|x| x.kind == Sk::Bar && matches!(cart.special, Special::None)).collect();
    if !bar_sers.is_empty() {
        let gap = band * cart.gap;
        let inner = band - gap;
        let nb = bar_sers.len().max(1) as f64;
        for i in 0..ncat {
            let (mut pos_acc, mut neg_acc) = (0.0, 0.0);
            for (si, x) in bar_sers.iter().enumerate() {
                let Some(val) = x.vals.get(i).copied().flatten() else { continue };
                let (from, to) = if cart.stack_bars {
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
                let (a, b) = (val_pos(x.secondary, from), val_pos(x.secondary, to));
                let (lo_p, size) = (a.min(b), (a - b).abs());
                let slot = if cart.stack_bars { inner } else { inner / nb };
                let off = cat_center(i) - inner / 2.0 + if cart.stack_bars { 0.0 } else { slot * si as f64 };
                let c = esc(&x.color);
                let stroke = if cart.gap == 0.0 { format!(r##" stroke="#ffffff" stroke-opacity="0.7" stroke-width="{}""##, n(fs * 0.06)) } else { String::new() };
                let _ = if horizontal {
                    write!(s, r#"<rect x="{}" y="{}" width="{}" height="{}" fill="{}"{}/>"#, n(lo_p), n(off), n(size), n(slot), c, stroke)
                } else {
                    write!(s, r#"<rect x="{}" y="{}" width="{}" height="{}" fill="{}"{}/>"#, n(off), n(lo_p), n(slot), n(size), c, stroke)
                };
                if r.data_labels && val != 0.0 {
                    let text = if cart.pct { fmt_axis(val, true) } else { label(val) };
                    let _ = if horizontal {
                        write!(s, r#"<text x="{}" y="{}">{}</text>"#, n(lo_p + size + fs * 0.25), n(off + slot / 2.0 + fs * 0.35), text)
                    } else {
                        write!(s, r#"<text x="{}" y="{}" text-anchor="middle">{}</text>"#, n(off + slot / 2.0), n(lo_p - fs * 0.3), text)
                    };
                }
            }
        }
    }
    // Areas, lines, scatter and bubbles, in series order (stacked ones accumulate).
    let mut acc = vec![0.0; ncat];
    let msize = sers.iter().flat_map(|x| x.sizes.iter().copied()).filter(|v| v.is_finite() && *v > 0.0).fold(0.0, f64::max).max(1e-9);
    for x in sers {
        if x.kind == Sk::Bar {
            continue;
        }
        let c = esc(&x.color);
        let stacked = cart.stack_lines && matches!(x.kind, Sk::Line | Sk::LineMarkers | Sk::Area);
        // (x, y, value, y of the baseline below it)
        let mut pts: Vec<(f64, f64, f64, f64)> = vec![];
        for i in 0..ncat {
            let Some(v) = x.vals.get(i).copied().flatten() else { continue };
            let Some(px) = pos_x(x, i) else { continue };
            let base_v = acc[i];
            let top_v = if stacked { base_v + v } else { v };
            if stacked {
                acc[i] = top_v;
            }
            let base_p = if stacked { val_pos(x.secondary, base_v) } else { zero };
            pts.push((px, val_pos(x.secondary, top_v), v, base_p));
        }
        if pts.is_empty() {
            continue;
        }
        if x.kind == Sk::Bubble {
            let maxr = (pw.min(ph) * 0.12).max(fs);
            for (k, p) in pts.iter().enumerate() {
                let size = x.sizes.get(k).copied().filter(|v| v.is_finite() && *v > 0.0).unwrap_or(msize * 0.3);
                let rr = (size / msize).sqrt() * maxr;
                let _ = write!(s, r#"<circle cx="{}" cy="{}" r="{}" fill="{}" fill-opacity="0.6" stroke="{}" stroke-width="{}"/>"#, n(p.0), n(p.1), n(rr), c, c, n(fs * 0.08));
                if r.data_labels {
                    let _ = write!(s, r#"<text x="{}" y="{}" text-anchor="middle">{}</text>"#, n(p.0), n(p.1 + fs * 0.35), label(size));
                }
            }
            continue;
        }
        let line: String = pts.iter().enumerate().map(|(k, p)| format!("{}{} {}", if k == 0 { "M" } else { " L" }, n(p.0), n(p.1))).collect();
        if x.kind == Sk::Area {
            let back: String = pts.iter().rev().map(|p| format!(" L{} {}", n(p.0), n(p.3))).collect();
            let _ = write!(s, r#"<path d="{}{} Z" fill="{}" fill-opacity="0.6"/>"#, line, back, c);
            let _ = write!(s, r#"<path d="{}" fill="none" stroke="{}" stroke-width="{}" stroke-linejoin="round"/>"#, line, c, n(fs * 0.12));
        }
        if matches!(x.kind, Sk::Line | Sk::LineMarkers) {
            let _ = write!(s, r#"<path d="{}" fill="none" stroke="{}" stroke-width="{}" stroke-linejoin="round" stroke-linecap="round"/>"#, line, c, n(fs * 0.22));
        }
        if matches!(x.kind, Sk::LineMarkers | Sk::Scatter) {
            for p in &pts {
                let _ = write!(s, r#"<circle cx="{}" cy="{}" r="{}" fill="{}"/>"#, n(p.0), n(p.1), n(fs * 0.3), c);
            }
        }
        if r.data_labels {
            for p in &pts {
                let text = if x.secondary && cart.pct2 { fmt_axis(p.2, true) } else { label(p.2) };
                let _ = write!(s, r#"<text x="{}" y="{}" text-anchor="middle">{}</text>"#, n(p.0), n(p.1 - fs * 0.6), text);
            }
        }
    }
    // Stock: the high-low line and the up/down box (open to close) or a close dash.
    if matches!(cart.special, Special::Stock) {
        for i in 0..ncat {
            let vals: Vec<f64> = sers.iter().filter_map(|x| x.vals.get(i).copied().flatten()).collect();
            if vals.len() < 2 {
                continue;
            }
            let (h, l) = (vals.iter().copied().fold(f64::MIN, f64::max), vals.iter().copied().fold(f64::MAX, f64::min));
            let cx = cat_center(i);
            let _ = write!(s, r#"<line x1="{}" y1="{}" x2="{}" y2="{}" stroke="{}" stroke-width="{}"/>"#, n(cx), n(val_pos(false, h)), n(cx), n(val_pos(false, l)), tc, n(fs * 0.1));
            let open = sers.first().and_then(|x| x.vals.get(i).copied().flatten());
            let close = sers.last().and_then(|x| x.vals.get(i).copied().flatten());
            if r.up_down_bars && sers.len() >= 4 {
                let (Some(o), Some(cl)) = (open, close) else { continue };
                let bw = band * 0.4;
                let y0 = val_pos(false, o.max(cl));
                let hgt = (val_pos(false, o.min(cl)) - y0).max(1.0);
                // White when the price rose, dark when it fell (PowerPoint's default).
                let _ = write!(s, r##"<rect x="{}" y="{}" width="{}" height="{}" fill="{}" stroke="{}" stroke-width="{}"/>"##, n(cx - bw / 2.0), n(y0), n(bw), n(hgt), if cl >= o { "#ffffff" } else { "#404040" }, tc, n(fs * 0.08));
            } else if let Some(cl) = close {
                let y = val_pos(false, cl);
                let _ = write!(s, r#"<line x1="{}" y1="{}" x2="{}" y2="{}" stroke="{}" stroke-width="{}"/>"#, n(cx - band * 0.12), n(y), n(cx + band * 0.12), n(y), esc(&sers.last().map(|x| x.color.clone()).unwrap_or_default()), n(fs * 0.25));
            }
        }
    }
}
