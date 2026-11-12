//! Picture Format › Adjust: Remove Background and the Artistic Effects are DeckCraft's
//! (`crates/engine/src/cmd/background.rs` and `artistic.rs`, MIT OR Apache-2.0); Corrections,
//! Color (saturation, tone, recolor presets), Set Transparent Color and Compress run here too.
//! The picture arrives as raw RGBA in the image buffer (`fc_img_reserve`) and leaves the same way.

use std::cell::RefCell;
use std::collections::VecDeque;

use deckcraft_color::{Rgba as Col, SchemeSlot};
use image::{GrayImage, Rgba, RgbaImage};
use serde::Deserialize;
use serde_json::json;

use crate::color::scheme_named;
use crate::{Res, fin};

thread_local! {
    pub(crate) static IMG: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

/// Size the image buffer to `len` bytes and return its address.
#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn fc_img_reserve(len: usize) -> *mut u8 {
    IMG.with(|b| {
        let mut b = b.borrow_mut();
        b.clear();
        b.resize(len, 0);
        b.as_mut_ptr()
    })
}

/// Address and length of the image buffer (after `picture.process`).
#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn fc_img_ptr() -> *const u8 {
    IMG.with(|b| b.borrow().as_ptr())
}

#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn fc_img_len() -> usize {
    IMG.with(|b| b.borrow().len())
}

/// Most pixels processed at once (about 33 megapixels).
const MAX_PIXELS: u64 = 33_000_000;

// ── DeckCraft: Remove Background ──────────────────────────────────────────────────────────────

fn dist(a: [u8; 4], b: [u8; 4]) -> f64 {
    let d = |i: usize| f64::from(a[i]) - f64::from(b[i]);
    (d(0) * d(0) + d(1) * d(1) + d(2) * d(2)).sqrt()
}

/// Make the background of `img` transparent. `tolerance` is 0–100. Returns how many pixels
/// became transparent.
pub fn matte(img: &mut RgbaImage, tolerance: f64) -> usize {
    let (w, h) = (img.width() as usize, img.height() as usize);
    if w == 0 || h == 0 {
        return 0;
    }
    let seed_tol = tolerance.clamp(0.0, 100.0) * 4.41;
    let step_tol = (seed_tol * 0.35).max(6.0);
    let px = |img: &RgbaImage, i: usize| img.get_pixel((i % w) as u32, (i / w) as u32).0;
    let mut bg = vec![false; w * h];
    let mut seed = vec![[0u8; 4]; w * h];
    let mut queue = VecDeque::new();
    let push_edge = |i: usize, bg: &mut [bool], seed: &mut [[u8; 4]], q: &mut VecDeque<usize>| {
        if let Some(b) = bg.get_mut(i)
            && !*b
        {
            *b = true;
            if let Some(s) = seed.get_mut(i) {
                *s = px(img, i);
            }
            q.push_back(i);
        }
    };
    for x in 0..w {
        push_edge(x, &mut bg, &mut seed, &mut queue);
        push_edge((h - 1) * w + x, &mut bg, &mut seed, &mut queue);
    }
    for y in 0..h {
        push_edge(y * w, &mut bg, &mut seed, &mut queue);
        push_edge(y * w + w - 1, &mut bg, &mut seed, &mut queue);
    }
    while let Some(i) = queue.pop_front() {
        let (x, y) = (i % w, i / w);
        let here = px(img, i);
        let from = seed.get(i).copied().unwrap_or(here);
        let mut near = [None; 4];
        if x > 0 {
            near[0] = Some(i - 1);
        }
        if x + 1 < w {
            near[1] = Some(i + 1);
        }
        if y > 0 {
            near[2] = Some(i - w);
        }
        if y + 1 < h {
            near[3] = Some(i + w);
        }
        for j in near.into_iter().flatten() {
            if bg.get(j).copied().unwrap_or(true) {
                continue;
            }
            let c = px(img, j);
            if c[3] < 16 || (dist(c, here) <= step_tol && dist(c, from) <= seed_tol) {
                if let Some(b) = bg.get_mut(j) {
                    *b = true;
                }
                if let Some(s) = seed.get_mut(j) {
                    *s = from;
                }
                queue.push_back(j);
            }
        }
    }
    let n = bg.iter().filter(|b| **b).count();
    if n == w * h {
        return 0;
    }
    let is_bg = |x: usize, y: usize| bg.get(y * w + x).copied().unwrap_or(false);
    let mut soft = vec![];
    for y in 0..h {
        for x in 0..w {
            if is_bg(x, y) {
                continue;
            }
            let touching =
                (x > 0 && is_bg(x - 1, y)) || (x + 1 < w && is_bg(x + 1, y)) || (y > 0 && is_bg(x, y - 1)) || (y + 1 < h && is_bg(x, y + 1));
            if touching {
                soft.push((x, y));
            }
        }
    }
    for (i, b) in bg.iter().enumerate() {
        if *b {
            img.get_pixel_mut((i % w) as u32, (i / w) as u32).0[3] = 0;
        }
    }
    for (x, y) in soft {
        let p = img.get_pixel_mut(x as u32, y as u32);
        p.0[3] = (u16::from(p.0[3]) * 2 / 3) as u8;
    }
    n
}

// ── DeckCraft: Artistic Effects ───────────────────────────────────────────────────────────────

fn luma(p: &Rgba<u8>) -> f32 {
    0.299 * p[0] as f32 + 0.587 * p[1] as f32 + 0.114 * p[2] as f32
}

fn gray(img: &RgbaImage) -> GrayImage {
    GrayImage::from_fn(img.width(), img.height(), |x, y| image::Luma([luma(img.get_pixel(x, y)).round().clamp(0.0, 255.0) as u8]))
}

fn edges(g: &GrayImage) -> GrayImage {
    let (w, h) = g.dimensions();
    let at = |x: i64, y: i64| g.get_pixel(x.clamp(0, w as i64 - 1) as u32, y.clamp(0, h as i64 - 1) as u32)[0] as f32;
    GrayImage::from_fn(w, h, |x, y| {
        let (x, y) = (x as i64, y as i64);
        let gx = at(x + 1, y - 1) + 2.0 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2.0 * at(x - 1, y) - at(x - 1, y + 1);
        let gy = at(x - 1, y + 1) + 2.0 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2.0 * at(x, y - 1) - at(x + 1, y - 1);
        image::Luma([((gx * gx + gy * gy).sqrt() / 4.0).clamp(0.0, 255.0) as u8])
    })
}

/// The Artistic Effects DeckCraft has: blur, pencil (grayscale), line drawing, photocopy, film
/// grain, cutout and glow edges.
pub const ARTISTIC: [&str; 7] =
    ["artisticBlur", "artisticPencilGrayscale", "artisticLineDrawing", "artisticPhotocopy", "artisticFilmGrain", "artisticCutout", "artisticGlowEdges"];

pub fn artistic(effect: &str, img: &RgbaImage) -> Option<RgbaImage> {
    let (w, h) = img.dimensions();
    let scale = ((w * w + h * h) as f32).sqrt() / 1000.0;
    let alpha = |x: u32, y: u32| img.get_pixel(x, y)[3];
    let out = match effect {
        "artisticBlur" => image::imageops::blur(img, (6.0 * scale).max(1.0)),
        "artisticPencilGrayscale" | "artisticLineDrawing" | "artisticPhotocopy" => {
            let soft = image::imageops::blur(&gray(img), (0.8 * scale).max(0.5));
            let e = edges(&soft);
            RgbaImage::from_fn(w, h, |x, y| {
                let ev = e.get_pixel(x, y)[0] as f32;
                let gv = soft.get_pixel(x, y)[0] as f32;
                let v = match effect {
                    "artisticPencilGrayscale" => 255.0 - ev * 2.0 - (255.0 - gv) * 0.25,
                    "artisticLineDrawing" => {
                        if ev > 28.0 {
                            255.0 - (ev - 28.0) * 3.0
                        } else {
                            255.0
                        }
                    }
                    _ => {
                        if ev > 40.0 || gv < 70.0 {
                            0.0
                        } else {
                            255.0
                        }
                    }
                };
                let v = v.clamp(0.0, 255.0) as u8;
                Rgba([v, v, v, alpha(x, y)])
            })
        }
        "artisticFilmGrain" => {
            let mut seed: u32 = 0x9E37_79B9;
            RgbaImage::from_fn(w, h, |x, y| {
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                let n = (seed % 61) as f32 - 30.0;
                let p = img.get_pixel(x, y);
                let c = |v: u8| ((v as f32 - 128.0) * 1.1 + 128.0 + n).clamp(0.0, 255.0) as u8;
                Rgba([c(p[0]), c(p[1]), c(p[2]), p[3]])
            })
        }
        "artisticCutout" => {
            let soft = image::imageops::blur(img, (1.5 * scale).max(0.5));
            RgbaImage::from_fn(w, h, |x, y| {
                let p = soft.get_pixel(x, y);
                let q = |v: u8| ((v as f32 / 255.0 * 3.0).round() / 3.0 * 255.0) as u8;
                Rgba([q(p[0]), q(p[1]), q(p[2]), alpha(x, y)])
            })
        }
        "artisticGlowEdges" => {
            let e = edges(&gray(img));
            RgbaImage::from_fn(w, h, |x, y| {
                let k = (e.get_pixel(x, y)[0] as f32 / 255.0 * 2.5).min(1.0);
                let p = img.get_pixel(x, y);
                let c = |v: u8| (v as f32 * k + 255.0 * k * 0.3).clamp(0.0, 255.0) as u8;
                Rgba([c(p[0]), c(p[1]), c(p[2]), p[3]])
            })
        }
        _ => return None,
    };
    Some(out)
}

// ── Corrections, Color and transparency ───────────────────────────────────────────────────────

/// The colours the Dark / Light variations use, in PowerPoint's gallery order: text colour 2,
/// then accents 1–6 (DeckCraft's `recolor::ACCENTS`).
const RECOLOR_SLOTS: [(&str, SchemeSlot); 7] = [
    ("tx2", SchemeSlot::Dk2),
    ("accent1", SchemeSlot::Accent1),
    ("accent2", SchemeSlot::Accent2),
    ("accent3", SchemeSlot::Accent3),
    ("accent4", SchemeSlot::Accent4),
    ("accent5", SchemeSlot::Accent5),
    ("accent6", SchemeSlot::Accent6),
];

/// Recolor presets, as DeckCraft lists them: none, grayscale, sepia, washout, black and white
/// 25/50/75 %, then each colour's dark and light variation (text colour 2 and accents 1–6).
pub fn recolor_presets() -> Vec<String> {
    let mut v: Vec<String> = ["none", "grayscale", "sepia", "washout", "bw25", "bw50", "bw75"].iter().map(|s| s.to_string()).collect();
    for (id, _) in RECOLOR_SLOTS {
        v.push(format!("{id}Dark"));
    }
    for (id, _) in RECOLOR_SLOTS {
        v.push(format!("{id}Light"));
    }
    v
}

fn duotone(img: &mut RgbaImage, dark: Col, light: Col) {
    for p in img.pixels_mut() {
        let t = luma(p) / 255.0;
        let mix = |a: u8, b: u8| (a as f32 + (b as f32 - a as f32) * t).round().clamp(0.0, 255.0) as u8;
        *p = Rgba([mix(dark.r, light.r), mix(dark.g, light.g), mix(dark.b, light.b), p[3]]);
    }
}

fn recolor(img: &mut RgbaImage, preset: &str, scheme: Option<&str>) {
    match preset {
        "grayscale" => {
            for p in img.pixels_mut() {
                let v = luma(p).round().clamp(0.0, 255.0) as u8;
                *p = Rgba([v, v, v, p[3]]);
            }
        }
        "sepia" => duotone(img, Col::rgb(0x40, 0x2A, 0x10), Col::rgb(0xF2, 0xE3, 0xC6)),
        "washout" => corrections(img, 0.7, -0.7, 0.0, 0.0),
        "bw25" | "bw50" | "bw75" => {
            let t = match preset {
                "bw25" => 0.25,
                "bw50" => 0.5,
                _ => 0.75,
            } * 255.0;
            for p in img.pixels_mut() {
                let v = if luma(p) >= t { 255 } else { 0 };
                *p = Rgba([v, v, v, p[3]]);
            }
        }
        other => {
            let Some((slot, dark)) = RECOLOR_SLOTS.iter().find_map(|(id, slot)| match other.strip_prefix(id) {
                Some("Dark") => Some((*slot, true)),
                Some("Light") => Some((*slot, false)),
                _ => None,
            }) else {
                return;
            };
            let c = scheme_named(scheme).get(slot);
            if dark {
                duotone(img, Col::BLACK, c);
            } else {
                duotone(img, c, Col::WHITE);
            }
        }
    }
}

/// Brightness and contrast −1…1 (PowerPoint's ±100 %), saturation −1…3 (0 % to PowerPoint's
/// 400 %, as DeckCraft's `picture.adjust` allows), temperature −1 (cool)…1 (warm).
fn corrections(img: &mut RgbaImage, brightness: f32, contrast: f32, saturation: f32, temperature: f32) {
    let b = brightness.clamp(-1.0, 1.0);
    let c = contrast.clamp(-1.0, 1.0);
    let k = if c >= 0.0 { 1.0 / (1.0 - c * 0.99) } else { 1.0 + c };
    let s = 1.0 + saturation.clamp(-1.0, 3.0);
    let t = temperature.clamp(-1.0, 1.0) * 40.0;
    for p in img.pixels_mut() {
        let l = luma(p);
        let mut ch = [p[0] as f32, p[1] as f32, p[2] as f32];
        for v in ch.iter_mut() {
            // Saturation about the grey of the pixel.
            *v = l + (*v - l) * s;
            // Brightness towards white / black, then contrast about the middle.
            *v = if b >= 0.0 { *v + (255.0 - *v) * b } else { *v * (1.0 + b) };
            *v = (*v - 128.0) * k + 128.0;
        }
        ch[0] += t;
        ch[2] -= t;
        *p = Rgba([ch[0].clamp(0.0, 255.0) as u8, ch[1].clamp(0.0, 255.0) as u8, ch[2].clamp(0.0, 255.0) as u8, p[3]]);
    }
}

fn sharpen(img: &RgbaImage, amount: f32) -> RgbaImage {
    if amount.abs() < 0.01 {
        return img.clone();
    }
    if amount < 0.0 {
        return image::imageops::blur(img, -amount * 3.0);
    }
    image::imageops::unsharpen(img, 1.5, (20.0 * (1.0 - amount.min(1.0))) as i32)
}

fn transparent_color(img: &mut RgbaImage, c: Col, tol: f64) {
    let target = [c.r, c.g, c.b, 255];
    let tol = tol.clamp(0.0, 100.0) * 4.41;
    for p in img.pixels_mut() {
        if dist(p.0, target) <= tol {
            p.0[3] = 0;
        }
    }
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Steps {
    pub remove_background: Option<f64>,
    pub transparent_color: Option<String>,
    pub transparent_tolerance: f64,
    pub brightness: f32,
    pub contrast: f32,
    pub saturation: f32,
    pub temperature: f32,
    pub sharpness: f32,
    pub recolor: Option<String>,
    pub artistic: Option<String>,
    /// Compress: the longest side at most this many pixels.
    pub max_side: Option<u32>,
}

#[derive(Deserialize)]
pub struct ProcessReq {
    pub w: u32,
    pub h: u32,
    #[serde(default)]
    pub steps: Steps,
    #[serde(default)]
    pub scheme: Option<String>,
}

/// Run the Picture Format pipeline on the RGBA in the image buffer: `{w, h, removed}`; the
/// result's RGBA replaces the buffer.
pub fn process(r: ProcessReq) -> Res {
    if u64::from(r.w) * u64::from(r.h) > MAX_PIXELS {
        return Err(format!("{}×{} pixels is too large; compress the picture first", r.w, r.h));
    }
    let data = IMG.with(|b| std::mem::take(&mut *b.borrow_mut()));
    let mut img = RgbaImage::from_raw(r.w, r.h, data).ok_or("the image buffer does not match its size")?;
    let st = &r.steps;
    if let Some(max) = st.max_side
        && max > 8
        && img.width().max(img.height()) > max
    {
        let k = max as f32 / img.width().max(img.height()) as f32;
        let (nw, nh) = (((img.width() as f32) * k).round().max(1.0) as u32, ((img.height() as f32) * k).round().max(1.0) as u32);
        img = image::imageops::resize(&img, nw, nh, image::imageops::FilterType::Triangle);
    }
    let mut removed = 0;
    if let Some(tol) = st.remove_background {
        removed = matte(&mut img, fin(tol, 20.0));
    }
    if let Some(c) = st.transparent_color.as_deref().and_then(Col::from_hex) {
        transparent_color(&mut img, c, fin(st.transparent_tolerance, 8.0));
    }
    if st.brightness != 0.0 || st.contrast != 0.0 || st.saturation != 0.0 || st.temperature != 0.0 {
        corrections(&mut img, st.brightness, st.contrast, st.saturation, st.temperature);
    }
    if st.sharpness != 0.0 {
        img = sharpen(&img, st.sharpness);
    }
    if let Some(p) = &st.recolor
        && p != "none"
    {
        recolor(&mut img, p, r.scheme.as_deref());
    }
    if let Some(e) = &st.artistic
        && let Some(out) = artistic(e, &img)
    {
        img = out;
    }
    let (w, h) = img.dimensions();
    IMG.with(|b| *b.borrow_mut() = img.into_raw());
    Ok(json!({ "w": w, "h": h, "removed": removed }))
}

pub fn catalog() -> Res {
    Ok(json!({ "artistic": ARTISTIC, "recolor": recolor_presets() }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn disc() -> RgbaImage {
        RgbaImage::from_fn(80, 60, |x, y| {
            let (dx, dy) = (f64::from(x) - 40.0, f64::from(y) - 30.0);
            if dx * dx + dy * dy < 15.0 * 15.0 {
                Rgba([220, 30, 30, 255])
            } else {
                let g = 255 - (x / 2) as u8;
                Rgba([g, g, g, 255])
            }
        })
    }

    #[test]
    fn matte_clears_the_gradient_and_keeps_the_subject() {
        let mut img = disc();
        let n = matte(&mut img, 20.0);
        assert!(n > 80 * 60 / 2, "{n}");
        assert_eq!(img.get_pixel(0, 0).0[3], 0);
        assert_eq!(img.get_pixel(40, 30).0, [220, 30, 30, 255]);
    }

    #[test]
    fn the_pipeline_runs_on_the_buffer() {
        let img = disc();
        IMG.with(|b| *b.borrow_mut() = img.into_raw());
        let out = process(ProcessReq {
            w: 80,
            h: 60,
            steps: Steps { recolor: Some("grayscale".into()), max_side: Some(40), ..Default::default() },
            scheme: None,
        })
        .unwrap();
        assert_eq!(out["w"], 40);
        assert_eq!(out["h"], 30);
        let data = IMG.with(|b| b.borrow().clone());
        assert_eq!(data.len(), 40 * 30 * 4);
        let p = &data[(15 * 40 + 20) * 4..(15 * 40 + 20) * 4 + 3];
        assert!(p[0] == p[1] && p[1] == p[2], "grey: {p:?}");
        for e in ARTISTIC {
            assert!(artistic(e, &disc()).is_some(), "{e}");
        }
    }

    #[test]
    fn recolor_lists_text_colour_two_and_maps_it_to_dk2() {
        let p = recolor_presets();
        assert_eq!(p.len(), 21);
        assert_eq!(p[7], "tx2Dark");
        assert_eq!(p[14], "tx2Light");
        // A white pixel through "tx2Dark" (black → dk2) becomes the scheme's dk2.
        let mut img = RgbaImage::from_pixel(2, 2, Rgba([255, 255, 255, 255]));
        recolor(&mut img, "tx2Dark", None);
        let dk2 = scheme_named(None).get(SchemeSlot::Dk2);
        assert_eq!(img.get_pixel(0, 0).0, [dk2.r, dk2.g, dk2.b, 255]);
        // Unknown names leave the picture alone.
        let mut img = RgbaImage::from_pixel(1, 1, Rgba([10, 20, 30, 255]));
        recolor(&mut img, "tx3Dark", None);
        assert_eq!(img.get_pixel(0, 0).0, [10, 20, 30, 255]);
    }

    #[test]
    fn saturation_goes_up_to_four_hundred_percent() {
        let px = Rgba([150, 100, 100, 255]);
        let mut two = RgbaImage::from_pixel(1, 1, px);
        corrections(&mut two, 0.0, 0.0, 1.0, 0.0);
        let mut four = RgbaImage::from_pixel(1, 1, px);
        corrections(&mut four, 0.0, 0.0, 3.0, 0.0);
        assert!(four.get_pixel(0, 0)[0] > two.get_pixel(0, 0)[0], "400 % is more saturated than 200 %");
    }
}
