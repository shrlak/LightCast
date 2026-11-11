//! FreeCast's PowerPoint engine.
//!
//! FreeCast draws slides in the browser (React), but what PowerPoint *does* — the geometry of its
//! preset shapes and their yellow adjust handles, Arrange (align, distribute, order, rotate, flip),
//! the slide-show timing of animations and the frames of slide transitions, table styles, charts,
//! the theme colour picker, find and replace — runs here, in Rust, compiled to WebAssembly.
//!
//! The heavy lifting comes from DeckCraft (https://github.com/storytold/deckcraft, MIT OR
//! Apache-2.0): its `geom` (183 preset shapes), `color`, `model` (tables, animation and transition
//! catalogues) and `anim` (timelines, transition frames) crates are used unchanged.
//!
//! # Calling convention
//!
//! One JSON request in, one JSON response out, through a byte buffer in linear memory — no
//! generated bindings, so the module has no imports:
//!
//! 1. `fc_reserve(len)` sizes the buffer and returns its address; the caller writes the request
//!    (UTF-8 JSON `{"op": "...", ...}`) there.
//! 2. `fc_call(len)` handles it and returns the response length.
//! 3. `fc_ptr()` is the response's address: `{"ok": value}` or `{"err": "message"}`.

use std::cell::RefCell;

use serde::de::DeserializeOwned;
use serde_json::{Value, json};

pub mod animation;
pub mod arrange;
pub mod chart;
pub mod color;
pub mod find;
pub mod geometry;
pub mod icons;
pub mod ink;
mod inkshape;
pub mod shapes;
pub mod table;
pub mod transition;

/// Engine version reported by `version`; bump when the request/response contract changes.
pub const VERSION: &str = "1.0.0";

thread_local! {
    static IO: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

/// Size the exchange buffer to `len` bytes and return its address.
#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn fc_reserve(len: usize) -> *mut u8 {
    IO.with(|b| {
        let mut b = b.borrow_mut();
        b.clear();
        b.resize(len, 0);
        b.as_mut_ptr()
    })
}

/// Handle the request in the first `len` bytes of the buffer; the response replaces it.
#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn fc_call(len: usize) -> usize {
    let input = IO.with(|b| {
        let b = b.borrow();
        b[..len.min(b.len())].to_vec()
    });
    let out = call_bytes(&input);
    IO.with(|b| {
        let n = out.len();
        *b.borrow_mut() = out;
        n
    })
}

/// Address of the response.
#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn fc_ptr() -> *const u8 {
    IO.with(|b| b.borrow().as_ptr())
}

/// A request as bytes → the response as bytes (what the exported functions do).
pub fn call_bytes(input: &[u8]) -> Vec<u8> {
    let resp = match serde_json::from_slice::<Value>(input) {
        Ok(req) => match handle(&req) {
            Ok(v) => json!({ "ok": v }),
            Err(e) => json!({ "err": e }),
        },
        Err(e) => json!({ "err": format!("bad request: {e}") }),
    };
    serde_json::to_vec(&resp).unwrap_or_else(|_| br#"{"err":"unserialisable response"}"#.to_vec())
}

pub type Res = Result<Value, String>;

/// Parse the request's parameters into `T`.
pub(crate) fn args<T: DeserializeOwned>(req: &Value) -> Result<T, String> {
    serde_json::from_value(req.clone()).map_err(|e| format!("bad arguments: {e}"))
}

pub(crate) fn to_value<T: serde::Serialize>(v: T) -> Res {
    serde_json::to_value(v).map_err(|e| e.to_string())
}

/// Run one request.
pub fn handle(req: &Value) -> Res {
    let op = req.get("op").and_then(Value::as_str).ok_or("request has no op")?;
    match op {
        "version" => Ok(json!({ "engine": VERSION, "deckcraft": "0.15.0" })),
        "shapes.catalog" => shapes::catalog(),
        "shape.geometry" => shapes::geometry(args(req)?),
        "shape.adjust" => shapes::adjust(args(req)?),
        "icons.catalog" => icons::catalog(),
        "arrange.align" => arrange::align(args(req)?),
        "arrange.distribute" => arrange::distribute(args(req)?),
        "arrange.order" => arrange::order(args(req)?),
        "arrange.flip" => arrange::flip(args(req)?),
        "arrange.rotate" => arrange::rotate_by(args(req)?),
        "geom.bounds" => geometry::bounds(args(req)?),
        "geom.hit" => geometry::hit(args(req)?),
        "geom.marquee" => geometry::marquee(args(req)?),
        "geom.resize" => geometry::resize(args(req)?),
        "geom.rotateTo" => geometry::rotate_to(args(req)?),
        "geom.snap" => geometry::snap(args(req)?),
        "anim.catalog" => animation::catalog(),
        "anim.prepare" => animation::prepare(args(req)?),
        "anim.sample" => animation::sample(args(req)?),
        "transition.catalog" => transition::catalog(),
        "transition.frame" => transition::frame(args(req)?),
        "table.styles" => table::styles(),
        "table.layout" => table::layout(args(req)?),
        "table.edit" => table::edit(args(req)?),
        "chart.svg" => chart::svg(args(req)?),
        "color.palette" => color::palette(args(req)?),
        "color.schemes" => color::schemes(),
        "color.contrast" => color::contrast(args(req)?),
        "color.shapeStyles" => color::shape_styles(args(req)?),
        "find.search" => find::search(args(req)?),
        "find.replace" => find::replace(args(req)?),
        "ink.smooth" => ink::smooth(args(req)?),
        "ink.recognize" => ink::recognize(args(req)?),
        _ => Err(format!("unknown op {op}")),
    }
}

/// A finite number or `d`.
pub(crate) fn fin(v: f64, d: f64) -> f64 {
    if v.is_finite() { v } else { d }
}

#[cfg(test)]
mod tests;
