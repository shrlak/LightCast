//! WordArt › Text Effects › Transform (DeckCraft's 40 `prstTxWarp` presets, with guide curves
//! fitted to PowerPoint's) and Shape Format › Edit Shape › Smooth Corners (DeckCraft's squircle).
//! The guides go to FreeCast as polylines; the app lays its glyphs along them.

use deckcraft_geom::squircle;
use deckcraft_geom::warp::{self, Band, Guide, LineAnchor};
use kurbo::Rect;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{Res, fin};

pub fn catalog() -> Res {
    Ok(json!(warp::CATALOG.iter().map(|p| json!({ "id": p.id, "label": p.label, "follow": warp::is_follow(p.id) })).collect::<Vec<_>>()))
}

#[derive(Deserialize)]
pub struct GuidesReq {
    pub preset: String,
    #[serde(default)]
    pub adj: Vec<f64>,
    pub w: f64,
    pub h: f64,
}

fn sample(g: &Guide, n: usize) -> Vec<[f64; 2]> {
    (0..=n).map(|i| {
        let p = g.at_frac(i as f64 / n as f64);
        [(p.x * 100.0).round() / 100.0, (p.y * 100.0).round() / 100.0]
    }).collect()
}

/// `{bands: [{kind: "fill", top, bottom} | {kind: "follow", path, anchor, closed}]}`, polylines in the box.
pub fn guides(r: GuidesReq) -> Res {
    if !warp::is_supported(&r.preset) {
        return Err(format!("unknown text transform {}", r.preset));
    }
    let adj: Vec<f64> = if r.adj.is_empty() { warp::adjust_defaults(&r.preset).to_vec() } else { r.adj.iter().take(8).copied().collect() };
    let rect = Rect::new(0.0, 0.0, fin(r.w, 100.0).max(1.0), fin(r.h, 100.0).max(1.0));
    let Some(w) = warp::warp(&r.preset, &adj, rect) else { return Err("no warp".into()) };
    let bands: Vec<Value> = w
        .bands
        .iter()
        .map(|b| match b {
            Band::Fill { top, bottom } => json!({ "kind": "fill", "top": sample(top, 96), "bottom": sample(bottom, 96) }),
            Band::Follow { path, anchor } => json!({
                "kind": "follow", "path": sample(path, 160), "closed": path.is_closed(),
                "anchor": match anchor { LineAnchor::Last => "last", LineAnchor::First => "first", LineAnchor::Middle => "middle" },
            }),
        })
        .collect();
    Ok(json!({ "bands": bands }))
}

#[derive(Deserialize)]
pub struct SmoothReq {
    pub w: f64,
    pub h: f64,
    /// Corner radius in the box's units (default: a fifth of the shorter side, PowerPoint's rounded rectangle).
    #[serde(default)]
    pub radius: Option<f64>,
    /// 0..1.
    pub smoothing: f64,
}

pub fn smooth_corners(r: SmoothReq) -> Res {
    let (w, h) = (fin(r.w, 100.0).max(1.0), fin(r.h, 100.0).max(1.0));
    let radius = r.radius.unwrap_or(w.min(h) * 0.1666);
    Ok(json!({ "path": squircle::path_d(w, h, radius, fin(r.smoothing, 0.0)), "pathW": w, "pathH": h }))
}
