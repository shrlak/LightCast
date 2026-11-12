//! Insert › Table and Table Design / Layout: DeckCraft's table model does the row and column edits
//! and merges; its table styles (Light 1/2, Medium 2/4, Dark 1 on Text 1 or any accent, with header
//! row, total row, first/last column and banding) colour the cells, as its renderer does.

use deckcraft_color::{ColorTransform, Rgba, SchemeSlot, apply};
use deckcraft_model::table::{Cell, Row, Table, table_styles};
use deckcraft_model::text::TextBody;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::color::{hex, scheme_named};
use crate::{Res, fin, to_value};

/// LightCast's table (what a `table` object on a slide keeps).
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TableIn {
    /// Rows of cells.
    pub rows: Vec<Vec<CellIn>>,
    /// Relative column widths.
    pub cols: Vec<f64>,
    /// Relative row heights.
    pub heights: Vec<f64>,
    pub style: String,
    pub first_row: bool,
    pub first_col: bool,
    pub last_row: bool,
    pub last_col: bool,
    pub band_row: bool,
    pub band_col: bool,
    /// Table Layout › Cell Margins (left, top, right, bottom; kept through edits).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub margins: Option<serde_json::Value>,
    /// Anything else LightCast keeps on the table, carried through edits untouched.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CellIn {
    pub text: String,
    #[serde(skip_serializing_if = "is_one")]
    pub span: u32,
    #[serde(skip_serializing_if = "is_one")]
    pub row_span: u32,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub h_merge: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub v_merge: bool,
    /// The cell's own look (shading, text colour, bold, alignment), kept through edits.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub align: Option<String>,
    /// Table Design › Borders drawn on this cell's sides (LightCast draws them; kept through edits).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub borders: Option<serde_json::Value>,
    /// The cell's other settings (vertical alignment, text direction…), kept through edits.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

fn is_one(v: &u32) -> bool {
    *v <= 1
}

/// `[{id, label}]`.
pub fn styles() -> Res {
    Ok(table_styles().into_iter().map(|(id, label)| json!({ "id": id, "label": label })).collect())
}

const MARK: char = '\u{1}';
const END: char = '\u{2}';

/// LightCast's table → DeckCraft's, each cell's text tagged with where it came from.
fn to_dc(t: &TableIn) -> Table {
    let nc = t.rows.iter().map(Vec::len).max().unwrap_or(1).max(1);
    let cols: Vec<f64> = (0..nc).map(|c| t.cols.get(c).map(|v| fin(*v, 1.0).max(0.01)).unwrap_or(1.0)).collect();
    let rows = t
        .rows
        .iter()
        .enumerate()
        .map(|(r, row)| Row {
            height: t.heights.get(r).map(|v| fin(*v, 1.0).max(0.01)).unwrap_or(1.0),
            cells: (0..nc)
                .map(|c| {
                    let x = row.get(c).cloned().unwrap_or_default();
                    let mut cell = Cell::new(&format!("{MARK}{r},{c}{END}{}", x.text));
                    cell.grid_span = x.span.max(1);
                    cell.row_span = x.row_span.max(1);
                    cell.h_merge = x.h_merge;
                    cell.v_merge = x.v_merge;
                    cell
                })
                .collect(),
        })
        .collect();
    Table { cols, rows, ..Default::default() }
}

/// Text with the origin tags removed, and the first origin.
fn untag(s: &str) -> (String, Option<(usize, usize)>) {
    let mut out = String::new();
    let mut first = None;
    let mut rest = s;
    while let Some(i) = rest.find(MARK) {
        out.push_str(&rest[..i]);
        let after = &rest[i + MARK.len_utf8()..];
        match after.find(END) {
            Some(j) => {
                if first.is_none() {
                    let mut it = after[..j].split(',').map(|v| v.parse::<usize>().ok());
                    if let (Some(Some(r)), Some(Some(c))) = (it.next(), it.next()) {
                        first = Some((r, c));
                    }
                }
                rest = &after[j + END.len_utf8()..];
            }
            None => {
                rest = after;
            }
        }
    }
    out.push_str(rest);
    (out, first)
}

fn from_dc(d: &Table, orig: &TableIn) -> TableIn {
    let rows = d
        .rows
        .iter()
        .map(|row| {
            row.cells
                .iter()
                .map(|cell| {
                    // A merge joins the cells' paragraphs; a paragraph that held only a tag (an
                    // empty cell taken in) leaves no blank line behind.
                    let mut src = None;
                    let mut lines = vec![];
                    for para in &cell.text.paragraphs {
                        let raw = para.text();
                        let (line, from) = untag(&raw);
                        src = src.or(from);
                        if !(from.is_some() && line.is_empty() && raw.starts_with(MARK)) || cell.text.paragraphs.len() == 1 {
                            lines.push(line);
                        }
                    }
                    let text = lines.join("\n");
                    let base = src.and_then(|(r, c)| orig.rows.get(r).and_then(|x| x.get(c))).cloned().unwrap_or_default();
                    CellIn {
                        text,
                        span: cell.grid_span.max(1),
                        row_span: cell.row_span.max(1),
                        h_merge: cell.h_merge,
                        v_merge: cell.v_merge,
                        fill: base.fill,
                        color: base.color,
                        bold: base.bold,
                        align: base.align,
                        borders: base.borders,
                        extra: base.extra,
                    }
                })
                .collect()
        })
        .collect();
    TableIn { rows, cols: d.cols.clone(), heights: d.rows.iter().map(|r| r.height).collect(), ..orig.clone() }
}

#[derive(Deserialize)]
pub struct EditReq {
    pub table: TableIn,
    /// insertRowAbove | insertRowBelow | insertColLeft | insertColRight | deleteRow | deleteCol |
    /// merge | split | distributeRows | distributeCols | new
    pub action: String,
    #[serde(default)]
    pub r: usize,
    #[serde(default)]
    pub c: usize,
    #[serde(default)]
    pub r1: usize,
    #[serde(default)]
    pub c1: usize,
}

/// The table after an edit.
pub fn edit(q: EditReq) -> Res {
    if q.action == "new" {
        let (nr, nc) = (q.r.clamp(1, 100), q.c.clamp(1, 50));
        let t = TableIn {
            rows: (0..nr).map(|_| (0..nc).map(|_| CellIn { span: 1, row_span: 1, ..Default::default() }).collect()).collect(),
            cols: vec![1.0; nc],
            heights: vec![1.0; nr],
            style: "medium2-accent1".into(),
            first_row: true,
            band_row: true,
            ..Default::default()
        };
        return to_value(t);
    }
    let mut d = to_dc(&q.table);
    d.normalize();
    let (r, c) = (q.r.min(d.rows.len().saturating_sub(1)), q.c.min(d.cols.len().saturating_sub(1)));
    match q.action.as_str() {
        "insertRowAbove" => d.insert_row(r),
        "insertRowBelow" => d.insert_row(r + 1),
        "insertColLeft" => d.insert_col(c),
        "insertColRight" => d.insert_col(c + 1),
        "deleteRow" => {
            d.delete_row(r);
        }
        "deleteCol" => {
            d.delete_col(c);
        }
        "merge" => {
            d.merge(r, c, q.r1, q.c1);
        }
        "split" => {
            d.split(r, c);
        }
        "distributeRows" => {
            let avg = d.rows.iter().map(|x| x.height).sum::<f64>() / d.rows.len().max(1) as f64;
            for row in &mut d.rows {
                row.height = avg;
            }
        }
        "distributeCols" => {
            let avg = d.cols.iter().sum::<f64>() / d.cols.len().max(1) as f64;
            for w in &mut d.cols {
                *w = avg;
            }
        }
        other => return Err(format!("unknown table action {other}")),
    }
    // New cells come back without a tag; an inserted row/column takes no look from its neighbours.
    for row in &mut d.rows {
        for cell in &mut row.cells {
            if cell.text.paragraphs.is_empty() {
                cell.text = TextBody::from_text("");
            }
        }
    }
    to_value(from_dc(&d, &q.table))
}

#[derive(Deserialize)]
pub struct LayoutReq {
    pub table: TableIn,
    pub w: f64,
    pub h: f64,
    #[serde(default)]
    pub scheme: Option<String>,
}

struct Part {
    header: bool,
    total: bool,
    first_col: bool,
    last_col: bool,
    banded: bool,
}

impl Part {
    fn strong(&self) -> bool {
        self.header || self.total || self.first_col || self.last_col
    }
}

struct Look {
    fill: Option<Rgba>,
    text: Option<Rgba>,
    bold: bool,
    border: Option<(Rgba, f64)>,
}

fn tint(a: Rgba, k: i32) -> Rgba {
    apply(a, &[ColorTransform::Tint(k)])
}

/// DeckCraft's preset table looks (`render/src/table.rs`).
fn look(kind: &str, a: Rgba, text_color: Rgba, p: &Part, on: &dyn Fn(Rgba) -> Rgba) -> Look {
    match kind {
        "none" => Look { fill: None, text: None, bold: false, border: None },
        "grid" => Look { fill: None, text: None, bold: false, border: Some((text_color, 0.75)) },
        "light1" => {
            let fill = p.banded.then(|| tint(a, 20000));
            Look { fill, text: fill.map(on), bold: p.strong(), border: if p.header { Some((a, 1.0)) } else { None } }
        }
        "light2" => Look {
            fill: if p.header { Some(a) } else { None },
            text: if p.header { Some(Rgba::WHITE) } else { None },
            bold: p.header || p.total || p.first_col,
            border: Some((a, 1.0)),
        },
        "dark1" => Look {
            fill: Some(if p.header {
                Rgba::BLACK
            } else if p.banded {
                apply(a, &[ColorTransform::Shade(60000)])
            } else {
                apply(a, &[ColorTransform::Shade(75000)])
            }),
            text: Some(Rgba::WHITE),
            bold: p.header || p.total || p.first_col,
            border: Some((Rgba::WHITE, 1.0)),
        },
        "medium4" => {
            let fill = if p.header || p.banded { tint(a, 40000) } else { tint(a, 20000) };
            Look { fill: Some(fill), text: Some(on(fill)), bold: p.strong(), border: Some((a, 0.75)) }
        }
        _ => {
            let strong = p.strong();
            let fill = if strong {
                a
            } else if p.banded {
                tint(a, 40000)
            } else {
                tint(a, 20000)
            };
            Look { fill: Some(fill), text: Some(if strong { Rgba::WHITE } else { on(fill) }), bold: strong, border: Some((Rgba::WHITE, 1.0)) }
        }
    }
}

fn edges(sizes: &[f64], total: f64) -> Vec<f64> {
    let sum: f64 = sizes.iter().map(|s| s.max(0.0)).sum();
    let k = if sum > 0.0 { total / sum } else { 0.0 };
    let mut v = vec![0.0];
    let mut a = 0.0;
    for s in sizes {
        a += s.max(0.0) * k;
        v.push(a);
    }
    v
}

/// Where every visible cell goes in a `w`×`h` table and how the style colours it:
/// `{cells: [{r, c, x, y, w, h, fill, color, bold, border, borderWidth}]}`.
pub fn layout(q: LayoutReq) -> Res {
    let t = &q.table;
    let s = scheme_named(q.scheme.as_deref());
    let nr = t.rows.len();
    let nc = t.rows.iter().map(Vec::len).max().unwrap_or(0);
    if nr == 0 || nc == 0 {
        return Ok(json!({ "cells": [] }));
    }
    let cols: Vec<f64> = (0..nc).map(|c| t.cols.get(c).copied().unwrap_or(1.0)).collect();
    let heights: Vec<f64> = (0..nr).map(|r| t.heights.get(r).copied().unwrap_or(1.0)).collect();
    let xs = edges(&cols, fin(q.w, 0.0).max(0.0));
    let ys = edges(&heights, fin(q.h, 0.0).max(0.0));
    let style = if t.style.is_empty() { "medium2-accent1" } else { t.style.as_str() };
    let kind = style.split('-').next().unwrap_or("medium2");
    let slot = match style.rsplit('-').next().unwrap_or("accent1") {
        "accent2" => SchemeSlot::Accent2,
        "accent3" => SchemeSlot::Accent3,
        "accent4" => SchemeSlot::Accent4,
        "accent5" => SchemeSlot::Accent5,
        "accent6" => SchemeSlot::Accent6,
        "tx1" => SchemeSlot::Tx1,
        _ => SchemeSlot::Accent1,
    };
    let a = s.get(slot);
    let (dk1, lt1) = (s.get(SchemeSlot::Dk1), s.get(SchemeSlot::Lt1));
    let on = |fill: Rgba| if dk1.contrast(fill) >= lt1.contrast(fill) { dk1 } else { lt1 };
    let mut cells: Vec<Value> = vec![];
    for (r, row) in t.rows.iter().enumerate() {
        for c in 0..nc {
            let cell = row.get(c).cloned().unwrap_or_default();
            if cell.h_merge || cell.v_merge {
                continue;
            }
            let c1 = (c + cell.span.max(1) as usize).min(nc);
            let r1 = (r + cell.row_span.max(1) as usize).min(nr);
            let header = t.first_row && r == 0;
            let total = t.last_row && r + 1 == nr;
            let body_r = if t.first_row { r.wrapping_sub(1) } else { r };
            let band = t.band_row && !header && !total && body_r % 2 == 0;
            let band_c = t.band_col && c % 2 == 0;
            let p = Part { header, total, first_col: t.first_col && c == 0, last_col: t.last_col && c + 1 == nc, banded: band || band_c };
            let l = look(kind, a, dk1, &p, &on);
            cells.push(json!({
                "r": r, "c": c,
                "x": xs[c], "y": ys[r], "w": xs[c1] - xs[c], "h": ys[r1] - ys[r],
                "text": cell.text,
                "fill": cell.fill.clone().or_else(|| l.fill.map(hex)),
                "color": cell.color.clone().or_else(|| l.text.map(hex)),
                "bold": cell.bold.unwrap_or(l.bold),
                "align": cell.align,
                "border": l.border.map(|b| hex(b.0)),
                "borderWidth": l.border.map(|b| b.1 * 2.0).unwrap_or(0.0),
            }));
        }
    }
    Ok(json!({ "cells": cells, "styleKind": kind }))
}
