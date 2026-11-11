//! Transitions tab and the slide show: DeckCraft's 49 transitions (Fade, Push, Wipe, Split, Reveal,
//! Cover, Uncover, Shape, Clock, Blinds, Checkerboard, Cube, Doors, Gallery, Zoom…) as frames of
//! textured quads of the old and new slide.

use deckcraft_model::anim::{TRANSITIONS, transition_option_label};
use serde::Deserialize;
use serde_json::json;

use crate::{Res, fin, to_value};

/// `[{id, label, category, durationMs, options: [{id, label}]}]`.
pub fn catalog() -> Res {
    Ok(TRANSITIONS
        .iter()
        .map(|t| {
            let options: Vec<_> = t.4.iter().map(|o| json!({ "id": o, "label": transition_option_label(t.0, o) })).collect();
            json!({ "id": t.0, "label": t.1, "category": t.2, "durationMs": t.3, "options": options })
        })
        .collect())
}

#[derive(Deserialize)]
pub struct FrameReq {
    pub kind: String,
    #[serde(default)]
    pub option: String,
    /// Progress 0..1 (linear; the effect eases itself).
    pub t: f64,
    /// Slide width per unit of height.
    #[serde(default)]
    pub aspect: f64,
}

/// The layers to draw, in order: `[{source, src, quad, uv, alpha, fade}]` in slide-unit space
/// (0..1, y down). `source` is `Old`, `New`, `Black`, `White`, `OldBack`, `NewBack`, `OldContent`
/// or `NewContent`.
pub fn frame(r: FrameReq) -> Res {
    let aspect = if fin(r.aspect, 0.0) > 0.0 { r.aspect } else { 4.0 / 3.0 };
    let kind = if r.kind == "morph" { "fade" } else { r.kind.as_str() };
    to_value(json!({
        "layers": deckcraft_anim::transition_frame(kind, &r.option, fin(r.t, 0.0), aspect),
        "parts": deckcraft_anim::uses_slide_parts(kind, &r.option),
    }))
}
