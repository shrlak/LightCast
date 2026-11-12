//! Animations tab and the slide show: DeckCraft's animation catalogue (entrance, emphasis, exit and
//! motion paths) and its timeline — click steps, With/After Previous, delays, repeats — sampled as
//! per-object states (opacity, offset, scale, rotation, reveal clip, tint).

use std::cell::RefCell;
use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use deckcraft_anim::{AnimState, Sequence, Timeline, TriggerPlay};
use deckcraft_model::anim::{ANIMATIONS, TextBuild};
use deckcraft_model::text::{Paragraph, TextBody};
use deckcraft_model::{AnimClass, AnimStart, Animation, Shape, ShapeId, Slide, Xfrm};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{Res, fin, to_value};

fn class_id(c: AnimClass) -> &'static str {
    match c {
        AnimClass::Entrance => "entrance",
        AnimClass::Emphasis => "emphasis",
        AnimClass::Exit => "exit",
        AnimClass::Path => "path",
        AnimClass::Media => "media",
    }
}

fn class_of(s: &str) -> AnimClass {
    match s {
        "emphasis" => AnimClass::Emphasis,
        "exit" => AnimClass::Exit,
        "path" => AnimClass::Path,
        _ => AnimClass::Entrance,
    }
}

/// `[{id, label, class, durationMs, options}]`.
pub fn catalog() -> Res {
    Ok(ANIMATIONS
        .iter()
        .filter(|a| a.2 != AnimClass::Media)
        .map(|a| json!({ "id": a.0, "label": a.1, "class": class_id(a.2), "durationMs": a.4, "options": a.5 }))
        .collect())
}

/// One effect of LightCast's animation list (the Animation Pane's order).
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimIn {
    pub element_id: String,
    pub effect: String,
    #[serde(default)]
    pub class: String,
    #[serde(default)]
    pub option: String,
    /// click | with | after
    #[serde(default)]
    pub start: String,
    #[serde(default)]
    pub duration_ms: u32,
    #[serde(default)]
    pub delay_ms: u32,
    #[serde(default)]
    pub repeat: u32,
    #[serde(default)]
    pub rewind: bool,
    /// Custom motion path (Animations › Motion Paths › Custom Path): `M 0 0 L dx dy …` in slide
    /// fractions, as offsets from where the object sits.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// Effect Options › Sequence: `paragraph` builds the text one paragraph at a time (단락별로);
    /// anything else animates the object as one (하나의 개체로).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub sequence: String,
    /// Animations › Trigger › On Click of: the object whose click plays this effect (an
    /// interactive sequence of its own, outside the slide's click steps).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trigger: Option<String>,
}

/// One paragraph of an object's text, as much as a by-paragraph build needs: its outline level and
/// whether it shows any text (blank paragraphs follow the one before them).
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub struct ParaRef {
    #[serde(default)]
    pub level: u8,
    #[serde(default)]
    pub filled: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct BoxRef {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    #[serde(default)]
    pub rot: f64,
    /// The object's paragraphs, sent for objects with a by-paragraph build.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub paras: Vec<ParaRef>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareReq {
    pub anims: Vec<AnimIn>,
    pub boxes: Vec<BoxRef>,
    pub slide_w: f64,
    pub slide_h: f64,
}

struct Prepared {
    tl: Timeline,
    /// Element id of shape `ShapeId(i + 1)`.
    ids: Vec<String>,
}

thread_local! {
    static CACHE: RefCell<HashMap<u64, Prepared>> = RefCell::new(HashMap::new());
}

fn build(r: &PrepareReq) -> Prepared {
    let ids: Vec<String> = r.boxes.iter().map(|b| b.id.clone()).collect();
    let shape_of = |id: &str| ids.iter().position(|x| x == id).map(|i| ShapeId(i as u32 + 1));
    let xfrms: Vec<Xfrm> = r
        .boxes
        .iter()
        .map(|b| Xfrm { x: fin(b.x, 0.0), y: fin(b.y, 0.0), w: fin(b.w, 1.0), h: fin(b.h, 1.0), rot: fin(b.rot, 0.0), flip_h: false, flip_v: false })
        .collect();
    // Only the paragraph structure matters to the timeline (DeckCraft's `paragraph_build_roles`):
    // a level per paragraph and a stand-in run for one that shows text.
    let text_of = |b: &BoxRef| {
        (!b.paras.is_empty()).then(|| TextBody {
            paragraphs: b
                .paras
                .iter()
                .take(10_000)
                .map(|p| Paragraph { level: p.level.min(8), ..Paragraph::new(if p.filled { "x" } else { "" }) })
                .collect(),
            ..Default::default()
        })
    };
    let shapes: Vec<Shape> = xfrms
        .iter()
        .zip(&r.boxes)
        .enumerate()
        .map(|(i, (x, b))| Shape { id: ShapeId(i as u32 + 1), xfrm: Some(*x), text: text_of(b), ..Default::default() })
        .collect();
    let animations: Vec<Animation> = r
        .anims
        .iter()
        .filter_map(|a| {
            let shape = shape_of(&a.element_id)?;
            let class = class_of(&a.class);
            let info = deckcraft_model::anim::animation_info(&a.effect, class);
            Some(Animation {
                shape,
                class: info.map(|i| i.2).unwrap_or(class),
                effect: a.effect.clone(),
                option: a.option.clone(),
                start: match a.start.as_str() {
                    "with" => AnimStart::WithPrevious,
                    "after" => AnimStart::AfterPrevious,
                    _ => AnimStart::OnClick,
                },
                duration_ms: if a.duration_ms > 0 { a.duration_ms.min(600_000) } else { info.map(|i| i.4).unwrap_or(500) },
                delay_ms: a.delay_ms.min(600_000),
                // `u32::MAX` is Repeat › Until Next Click; any other count is capped.
                repeat: if a.repeat == u32::MAX { u32::MAX } else { a.repeat.clamp(1, 1000) },
                rewind: a.rewind,
                text_build: if a.sequence == "paragraph" { TextBuild::ByParagraph } else { TextBuild::AsOne },
                path: match &a.path {
                    Some(p) if class == AnimClass::Path && !p.trim().is_empty() => Some(p.clone()),
                    _ if class == AnimClass::Path => deckcraft_model::anim::preset_path(&a.effect),
                    _ => None,
                },
                // A trigger on the object itself, or on one not on the slide, plays with the clicks.
                trigger: a.trigger.as_deref().and_then(shape_of).filter(|t| *t != shape),
                ..Default::default()
            })
        })
        .collect();
    let slide = Slide { shapes, animations, ..Default::default() };
    let tl = Timeline::with(&slide, fin(r.slide_w, 1440.0), fin(r.slide_h, 1080.0), None, &|id: ShapeId| {
        xfrms.get((id.0 as usize).wrapping_sub(1)).copied()
    });
    Prepared { tl, ids }
}

fn key_of(r: &PrepareReq) -> u64 {
    let mut h = DefaultHasher::new();
    serde_json::to_string(r).unwrap_or_default().hash(&mut h);
    h.finish()
}

/// Build (and keep) a slide's timeline: `{key, steps, auto, durations, effects}`. `effects` lists
/// each effect's click step and timing in seconds, for the numbers the editor shows on objects.
pub fn prepare(r: PrepareReq) -> Res {
    let key = key_of(&r);
    CACHE.with(|c| {
        let mut c = c.borrow_mut();
        if !c.contains_key(&key) {
            if c.len() >= 64 {
                c.clear();
            }
            c.insert(key, build(&r));
        }
        let p = c.get(&key).ok_or("timeline missing")?;
        let steps = p.tl.steps();
        let effects: Vec<Value> = p
            .tl
            .effects()
            .iter()
            .map(|e| {
                json!({
                    "index": e.anim,
                    "elementId": p.ids.get((e.shape.0 as usize).wrapping_sub(1)),
                    "paragraph": e.paragraph,
                    "step": e.step,
                    "start": e.start,
                    "duration": e.duration,
                    "span": e.span,
                    "class": class_id(e.class),
                    "trigger": match e.sequence {
                        Sequence::Trigger(t) => p.ids.get((t.0 as usize).wrapping_sub(1)).cloned(),
                        Sequence::Main => None,
                    },
                })
            })
            .collect();
        // Interactive sequences: each trigger object, its clicks and how long each one plays.
        let triggers: Vec<Value> = p
            .tl
            .trigger_shapes()
            .into_iter()
            .filter_map(|t| {
                let id = p.ids.get((t.0 as usize).wrapping_sub(1))?;
                let n = p.tl.trigger_steps(t);
                Some(json!({ "elementId": id, "steps": n, "durations": (0..n).map(|i| p.tl.trigger_step_duration(t, i)).collect::<Vec<_>>() }))
            })
            .collect();
        Ok(json!({
            "key": key.to_string(),
            "steps": steps,
            "auto": (0..steps).map(|i| p.tl.step_is_auto(i)).collect::<Vec<_>>(),
            "durations": (0..steps).map(|i| p.tl.step_duration(i)).collect::<Vec<_>>(),
            "total": p.tl.total_duration(),
            "effects": effects,
            "triggers": triggers,
        }))
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StateOut {
    visible: bool,
    opacity: f64,
    dx: f64,
    dy: f64,
    sx: f64,
    sy: f64,
    rotate: f64,
    /// Reveal clip in the object's unit square: l, t, r, b.
    clip: Option<[f64; 4]>,
    tint: Option<String>,
}

impl From<AnimState> for StateOut {
    fn from(s: AnimState) -> Self {
        StateOut {
            visible: s.visible,
            opacity: fin(s.opacity, 1.0),
            dx: fin(s.offset_x, 0.0),
            dy: fin(s.offset_y, 0.0),
            sx: fin(s.scale_x, 1.0),
            sy: fin(s.scale_y, 1.0),
            rotate: fin(s.rotate, 0.0),
            clip: s.clip,
            tint: s.tint.map(|c| format!("#{}", c.hex())),
        }
    }
}

#[derive(Deserialize)]
pub struct SampleReq {
    /// From `anim.prepare`; or the full request to prepare on the fly.
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub spec: Option<PrepareReq>,
    /// Main click steps already played.
    pub step: usize,
    /// Seconds into step `step` (≤ 0: not started).
    pub t: f64,
    /// Playheads of the triggered sequences: clicks on the trigger fully played and seconds into
    /// the one playing.
    #[serde(default)]
    pub triggers: Vec<TriggerIn>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerIn {
    pub element_id: String,
    pub step: usize,
    #[serde(default)]
    pub t: f64,
}

/// `{elementId: state}` for every animated object at (`step`, `t`), and `{"elementId#p": state}` for
/// each paragraph `p` a by-paragraph build animates (relative to the object's own state).
pub fn sample(r: SampleReq) -> Res {
    let key = match (&r.key, &r.spec) {
        (_, Some(spec)) => {
            let k = key_of(spec);
            CACHE.with(|c| {
                let mut c = c.borrow_mut();
                if !c.contains_key(&k) {
                    if c.len() >= 64 {
                        c.clear();
                    }
                    c.insert(k, build(spec));
                }
            });
            k
        }
        (Some(k), None) => k.parse::<u64>().map_err(|_| "bad key")?,
        (None, None) => return Err("no key or spec".into()),
    };
    CACHE.with(|c| {
        let c = c.borrow();
        let p = c.get(&key).ok_or("unknown timeline (prepare it again)")?;
        let mut out = serde_json::Map::new();
        let plays: Vec<TriggerPlay> = r
            .triggers
            .iter()
            .filter_map(|t| {
                let i = p.ids.iter().position(|x| *x == t.element_id)?;
                Some(TriggerPlay { trigger: ShapeId(i as u32 + 1), step: t.step, t: fin(t.t, 0.0) })
            })
            .collect();
        for shape in p.tl.animated_shapes() {
            let Some(id) = p.ids.get((shape.0 as usize).wrapping_sub(1)) else { continue };
            let st: StateOut = p.tl.state_with(shape, None, r.step, fin(r.t, 0.0), &plays).into();
            out.insert(id.clone(), to_value(st)?);
            for para in p.tl.paragraph_targets(shape) {
                let st: StateOut = p.tl.state_with(shape, Some(para), r.step, fin(r.t, 0.0), &plays).into();
                out.insert(format!("{id}#{para}"), to_value(st)?);
            }
        }
        Ok(Value::Object(out))
    })
}
