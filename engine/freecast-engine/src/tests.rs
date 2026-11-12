use serde_json::{Value, json};

use crate::handle;

fn ok(req: Value) -> Value {
    match handle(&req) {
        Ok(v) => v,
        Err(e) => panic!("{req} failed: {e}"),
    }
}

#[test]
fn the_byte_interface_answers_json() {
    let out = crate::call_bytes(br#"{"op":"version"}"#);
    let v: Value = serde_json::from_slice(&out).unwrap();
    assert_eq!(v["ok"]["engine"], crate::VERSION);
    let bad: Value = serde_json::from_slice(&crate::call_bytes(b"not json")).unwrap();
    assert!(bad["err"].as_str().unwrap().contains("bad request"));
    let unknown: Value = serde_json::from_slice(&crate::call_bytes(br#"{"op":"nope"}"#)).unwrap();
    assert!(unknown["err"].is_string());
}

#[test]
fn every_preset_shape_builds() {
    let cat = ok(json!({"op": "shapes.catalog"}));
    let list = cat.as_array().unwrap();
    assert!(list.len() >= 180, "DeckCraft ships 183 presets, got {}", list.len());
    for p in list {
        let name = p["name"].as_str().unwrap();
        let g = ok(json!({"op": "shape.geometry", "name": name, "w": 300.0, "h": 200.0}));
        let paths = g["paths"].as_array().unwrap();
        assert!(!paths.is_empty(), "{name} has no outline");
        assert!(paths.iter().all(|p| p["d"].as_str().unwrap().starts_with('M')), "{name} path");
    }
}

#[test]
fn an_adjust_handle_drag_changes_the_shape() {
    let g = ok(json!({"op": "shape.geometry", "name": "roundRect", "w": 400.0, "h": 200.0}));
    let h = &g["handles"][0];
    assert_eq!(h["index"], 0);
    let adj = ok(json!({"op": "shape.adjust", "name": "roundRect", "w": 400.0, "h": 200.0, "adj": [], "index": 0, "x": 100.0, "y": 0.0}));
    let v = adj[0].as_f64().unwrap();
    assert!(v > 16667.0, "dragging the corner handle inwards rounds more: {v}");
    // Unknown names fall back to a rectangle rather than failing.
    let r = ok(json!({"op": "shape.geometry", "name": "noSuchShape", "w": 10.0, "h": 10.0}));
    assert_eq!(r["paths"].as_array().unwrap().len(), 1);
}

#[test]
fn align_and_distribute_move_by_the_drawn_bounds() {
    let boxes = json!([
        {"id": "a", "x": 100, "y": 100, "w": 100, "h": 50},
        {"id": "b", "x": 400, "y": 300, "w": 200, "h": 50},
        {"id": "c", "x": 1000, "y": 500, "w": 100, "h": 50}
    ]);
    let left = ok(json!({"op": "arrange.align", "boxes": boxes, "edge": "left", "to": "selection", "slideW": 1440, "slideH": 1080}));
    assert_eq!(left[1]["dx"], -300.0);
    let slide = ok(json!({"op": "arrange.align", "boxes": [{"id": "a", "x": 100, "y": 100, "w": 100, "h": 50}], "edge": "center", "to": "selection", "slideW": 1440, "slideH": 1080}));
    assert_eq!(slide[0]["dx"], 570.0, "one object centres on the slide");
    let dist = ok(json!({"op": "arrange.distribute", "boxes": boxes, "dir": "horizontal", "to": "selection", "slideW": 1440, "slideH": 1080}));
    // Gaps: total span 100..1100 = 1000, widths 400 → two gaps of 300; b moves to 500.
    let b = dist.as_array().unwrap().iter().find(|x| x["id"] == "b").unwrap();
    assert_eq!(b["dx"], 100.0);
}

#[test]
fn ordering_follows_powerpoint() {
    let ids = json!(["a", "b", "c", "d"]);
    assert_eq!(ok(json!({"op": "arrange.order", "ids": ids, "sel": ["b"], "how": "front"})), json!(["a", "c", "d", "b"]));
    assert_eq!(ok(json!({"op": "arrange.order", "ids": ids, "sel": ["c"], "how": "back"})), json!(["c", "a", "b", "d"]));
    assert_eq!(ok(json!({"op": "arrange.order", "ids": ids, "sel": ["b"], "how": "forward"})), json!(["a", "c", "b", "d"]));
    assert_eq!(ok(json!({"op": "arrange.order", "ids": ids, "sel": ["a"], "how": "backward"})), json!(["a", "b", "c", "d"]));
}

#[test]
fn resizing_a_rotated_box_keeps_the_opposite_corner() {
    let b = json!({"id": "x", "x": 0, "y": 0, "w": 200, "h": 100, "rot": 90});
    let r = ok(json!({"op": "geom.resize", "box": b, "handle": "e", "dx": 0, "dy": 50}));
    // Rotated 90°, the east handle points down: dragging down 50 widens by 50.
    assert!((r["w"].as_f64().unwrap() - 250.0).abs() < 1e-6);
    assert!((r["h"].as_f64().unwrap() - 100.0).abs() < 1e-6);
    let s = ok(json!({"op": "geom.resize", "box": {"id": "y", "x": 0, "y": 0, "w": 200, "h": 100}, "handle": "se", "dx": 200, "dy": 0, "keepAspect": true}));
    assert!((s["h"].as_f64().unwrap() - 200.0).abs() < 1e-6, "Shift keeps 2:1");
    assert_eq!(s["x"], 0.0);
    let rot = ok(json!({"op": "geom.rotateTo", "box": {"id": "z", "x": 0, "y": 0, "w": 100, "h": 100}, "x": 100, "y": 50, "snap": true}));
    assert_eq!(rot, 90.0);
}

#[test]
fn hit_testing_and_marquee() {
    let boxes = json!([{"id": "back", "x": 0, "y": 0, "w": 500, "h": 500}, {"id": "front", "x": 100, "y": 100, "w": 100, "h": 100}]);
    assert_eq!(ok(json!({"op": "geom.hit", "boxes": boxes, "x": 150, "y": 150})), "front");
    assert_eq!(ok(json!({"op": "geom.hit", "boxes": boxes, "x": 400, "y": 400})), "back");
    assert_eq!(ok(json!({"op": "geom.hit", "boxes": boxes, "x": 900, "y": 900})), Value::Null);
    assert_eq!(ok(json!({"op": "geom.marquee", "boxes": boxes, "x": 50, "y": 50, "w": 200, "h": 200})), json!(["front"]));
    let snap = ok(json!({"op": "geom.snap", "box": {"id": "m", "x": 713, "y": 300, "w": 0, "h": 10}, "others": [], "slideW": 1440, "slideH": 1080}));
    assert_eq!(snap["x"], 720.0);
    assert_eq!(snap["guides"]["v"], json!([720.0]));
}

#[test]
fn animations_build_click_steps() {
    let spec = json!({
        "anims": [
            {"elementId": "t", "effect": "fade", "class": "entrance", "start": "click", "durationMs": 500},
            {"elementId": "p", "effect": "fly", "class": "entrance", "option": "b", "start": "after", "durationMs": 500},
            {"elementId": "t", "effect": "spin", "class": "emphasis", "start": "click", "durationMs": 1000}
        ],
        "boxes": [{"id": "t", "x": 100, "y": 100, "w": 400, "h": 200}, {"id": "p", "x": 600, "y": 600, "w": 300, "h": 200}],
        "slideW": 1440, "slideH": 1080
    });
    let mut req = spec.clone();
    req["op"] = json!("anim.prepare");
    let p = ok(req);
    assert_eq!(p["steps"], 2);
    let key = p["key"].as_str().unwrap().to_string();
    let before = ok(json!({"op": "anim.sample", "key": key, "step": 0, "t": 0.0}));
    assert_eq!(before["t"]["visible"], false, "an entrance waits for its click");
    assert_eq!(before["p"]["visible"], false);
    let mid = ok(json!({"op": "anim.sample", "key": key, "step": 0, "t": 0.25}));
    let o = mid["t"]["opacity"].as_f64().unwrap();
    assert!(o > 0.05 && o < 0.95, "half way through a fade: {o}");
    let done = ok(json!({"op": "anim.sample", "key": key, "step": 2, "t": 0.0}));
    assert_eq!(done["p"]["visible"], true);
    assert!(done["p"]["dy"].as_f64().unwrap().abs() < 1e-6, "flown in");
    let cat = ok(json!({"op": "anim.catalog"}));
    assert!(cat.as_array().unwrap().len() > 60);
}

#[test]
fn a_by_paragraph_build_takes_a_click_per_paragraph() {
    // Three top paragraphs, the second with a deeper one under it and a blank line after.
    let paras = json!([
        {"level": 0, "filled": true}, {"level": 0, "filled": true}, {"level": 1, "filled": true},
        {"level": 0, "filled": false}, {"level": 0, "filled": true}
    ]);
    let spec = |start: &str| json!({
        "anims": [{"elementId": "t", "effect": "fade", "class": "entrance", "start": start, "durationMs": 500, "sequence": "paragraph"}],
        "boxes": [{"id": "t", "x": 100, "y": 100, "w": 400, "h": 400, "paras": paras}],
        "slideW": 1440, "slideH": 1080
    });
    let mut req = spec("click");
    req["op"] = json!("anim.prepare");
    let p = ok(req);
    assert_eq!(p["steps"], 3, "one click per top paragraph");
    let fx = p["effects"].as_array().unwrap();
    assert_eq!(fx.iter().map(|e| e["paragraph"].as_u64().unwrap()).collect::<Vec<_>>(), vec![0, 1, 4]);
    assert_eq!(fx.iter().map(|e| e["step"].as_u64().unwrap()).collect::<Vec<_>>(), vec![0, 1, 2]);
    let key = p["key"].as_str().unwrap().to_string();
    let at = |step: usize| ok(json!({"op": "anim.sample", "key": key, "step": step, "t": 0.0}));
    let s1 = at(1);
    assert_eq!(s1["t"]["visible"], true, "the box itself stays put");
    assert_eq!(s1["t#0"]["visible"], true);
    assert_eq!(s1["t#1"]["visible"], false);
    assert_eq!(s1["t#2"]["visible"], false, "a deeper paragraph follows its parent");
    assert_eq!(s1["t#3"]["visible"], false);
    let s2 = at(2);
    assert_eq!(s2["t#2"]["visible"], true);
    assert_eq!(s2["t#4"]["visible"], false);
    assert_eq!(at(3)["t#4"]["visible"], true);
    // After Previous: one step, the paragraphs one after another.
    let mut req = spec("after");
    req["op"] = json!("anim.prepare");
    let p = ok(req);
    assert_eq!(p["steps"], 1);
    let starts: Vec<f64> = p["effects"].as_array().unwrap().iter().map(|e| e["start"].as_f64().unwrap()).collect();
    assert!(starts[0] < starts[1] && starts[1] < starts[2], "{starts:?}");
}

#[test]
fn transitions_give_frames() {
    let cat = ok(json!({"op": "transition.catalog"}));
    assert!(cat.as_array().unwrap().len() >= 45);
    for t in cat.as_array().unwrap() {
        let kind = t["id"].as_str().unwrap();
        let f = ok(json!({"op": "transition.frame", "kind": kind, "t": 0.5, "aspect": 4.0 / 3.0}));
        assert!(f["layers"].is_array(), "{kind}");
    }
    let end = ok(json!({"op": "transition.frame", "kind": "push", "option": "l", "t": 1.0}));
    assert_eq!(end["layers"].as_array().unwrap().len(), 1);
    assert_eq!(end["layers"][0]["source"], "New");
}

#[test]
fn tables_edit_and_style() {
    let t = ok(json!({"op": "table.edit", "table": {}, "action": "new", "r": 3, "c": 3}));
    assert_eq!(t["rows"].as_array().unwrap().len(), 3);
    let mut t = t;
    t["rows"][0][0]["text"] = json!("A");
    t["rows"][0][1]["text"] = json!("B");
    t["rows"][1][0]["fill"] = json!("#ff0000");
    let merged = ok(json!({"op": "table.edit", "table": t, "action": "merge", "r": 0, "c": 0, "r1": 0, "c1": 1}));
    assert_eq!(merged["rows"][0][0]["text"], "A\nB");
    assert_eq!(merged["rows"][0][0]["span"], 2);
    assert_eq!(merged["rows"][0][1]["hMerge"], true);
    let ins = ok(json!({"op": "table.edit", "table": merged, "action": "insertRowAbove", "r": 1, "c": 0}));
    assert_eq!(ins["rows"].as_array().unwrap().len(), 4);
    assert_eq!(ins["rows"][2][0]["fill"], "#ff0000", "a cell's own look moves with it");
    let lay = ok(json!({"op": "table.layout", "table": ins, "w": 900, "h": 400}));
    let cells = lay["cells"].as_array().unwrap();
    assert_eq!(cells[0]["w"], 600.0, "the merged header spans two columns");
    assert_eq!(cells[0]["bold"], true);
    assert!(ok(json!({"op": "table.styles"})).as_array().unwrap().len() > 30);
}

#[test]
fn charts_draw_svg() {
    for kind in ["column", "columnStacked", "bar", "barStacked", "line", "area", "pie", "doughnut", "scatter"] {
        let c = ok(json!({"op": "chart.svg", "kind": kind, "title": "출석", "categories": ["1월", "2월", "3월"],
            "series": [{"name": "청년부", "values": [12, 18, 15]}, {"name": "장년부", "values": [30, 28, 35]}], "w": 800, "h": 500, "dataLabels": true}));
        let svg = c["svg"].as_str().unwrap();
        assert!(svg.starts_with("<svg") && svg.ends_with("</svg>"), "{kind}");
        assert!(svg.contains("출석"));
    }
    assert_eq!(crate::chart::nice_axis(0.0, 35.0, 5), (0.0, 40.0, 10.0));
}

#[test]
fn colours_and_contrast() {
    let p = ok(json!({"op": "color.palette"}));
    assert_eq!(p["theme"].as_array().unwrap().len(), 10);
    assert_eq!(p["theme"][0]["shades"].as_array().unwrap().len(), 5);
    assert_eq!(p["standard"].as_array().unwrap().len(), 10);
    let c = ok(json!({"op": "color.contrast", "fg": "#ffffff", "bg": "#000000"}));
    assert_eq!(c["ratio"], 21.0);
    assert!(ok(json!({"op": "color.schemes"})).as_array().unwrap().len() >= 8);
    assert_eq!(ok(json!({"op": "color.shapeStyles"})).as_array().unwrap().len(), 42);
}

#[test]
fn find_and_replace_in_korean() {
    let items = json!([{"key": "s1", "text": "주 예수 사랑해요\n예수 예수"}, {"key": "s2", "text": "Jesus loves me, JESUS"}]);
    let hits = ok(json!({"op": "find.search", "items": items, "query": "예수"}));
    assert_eq!(hits.as_array().unwrap().len(), 3);
    assert_eq!(hits[0]["start"], 2);
    let ci = ok(json!({"op": "find.search", "items": items, "query": "jesus"}));
    assert_eq!(ci.as_array().unwrap().len(), 2);
    let cs = ok(json!({"op": "find.search", "items": items, "query": "jesus", "matchCase": true}));
    assert_eq!(cs.as_array().unwrap().len(), 0);
    let rep = ok(json!({"op": "find.replace", "items": items, "query": "예수", "replacement": "주님"}));
    assert_eq!(rep["count"], 3);
    assert_eq!(rep["items"][0]["text"], "주 주님 사랑해요\n주님 주님");
    let whole = ok(json!({"op": "find.search", "items": [{"key": "a", "text": "사랑 사랑해"}], "query": "사랑", "wholeWord": true}));
    assert_eq!(whole.as_array().unwrap().len(), 1);
}

#[test]
fn ink_smooths_and_turns_into_shapes() {
    let mut pts = vec![];
    for i in 0..=40 {
        pts.push([100.0 + i as f64 * 5.0, 100.0]);
    }
    for i in 0..=20 {
        pts.push([300.0, 100.0 + i as f64 * 5.0]);
    }
    for i in 0..=40 {
        pts.push([300.0 - i as f64 * 5.0, 200.0]);
    }
    for i in 0..=20 {
        pts.push([100.0, 200.0 - i as f64 * 5.0]);
    }
    let s = ok(json!({"op": "ink.smooth", "points": pts, "tolerance": 1.0}));
    assert!(s["d"].as_str().unwrap().starts_with('M'));
    assert!(s["points"].as_u64().unwrap() < 20);
    let r = ok(json!({"op": "ink.recognize", "points": pts}));
    assert_eq!(r["kind"], "rect");
    assert!(crate::icons::count() > 50);
    let icons = ok(json!({"op": "icons.catalog"}));
    assert!(icons[0]["d"].is_array());
}

#[test]
fn every_smartart_layout_lays_out() {
    let cat = ok(json!({"op": "smartart.catalog"}));
    let layouts = cat["layouts"].as_array().unwrap();
    assert_eq!(layouts.len(), 45);
    let nodes = json!([
        {"text": "기도", "level": 0}, {"text": "말씀", "level": 1}, {"text": "찬양", "level": 0},
        {"text": "교제", "level": 0}, {"text": "섬김", "level": 1}
    ]);
    for l in layouts {
        let id = l["id"].as_str().unwrap();
        for style in ["flat", "subtle", "polished"] {
            let r = ok(json!({"op": "smartart.layout", "kind": id, "nodes": nodes, "style": style, "colors": "colorful", "x": 100, "y": 100, "w": 1200, "h": 800}));
            let shapes = r["shapes"].as_array().unwrap();
            assert!(!shapes.is_empty(), "{id}");
            for s in shapes {
                assert!(s["shape"].is_string() || s["custom"].is_object(), "{id}: {s}");
                assert!(s["w"].as_f64().unwrap() > 0.0 || s["h"].as_f64().unwrap() > 0.0, "{id}");
            }
            assert!(shapes.iter().any(|s| s["text"].as_str().is_some_and(|t| t.contains("기도"))), "{id} shows its text");
        }
    }
    let lines = ok(json!({"op": "smartart.fromLines", "lines": ["A", "\tB", "C"]}));
    assert_eq!(lines[1]["level"], 1);
}

#[test]
fn merge_shapes_like_powerpoint() {
    let a = json!({"shape": "rect", "x": 0, "y": 0, "w": 100, "h": 100});
    let b = json!({"shape": "ellipse", "x": 50, "y": 0, "w": 100, "h": 100});
    let area = |r: &Value| r["w"].as_f64().unwrap() * r["h"].as_f64().unwrap();
    let union = ok(json!({"op": "shape.merge", "mode": "union", "shapes": [a, b]}));
    assert_eq!(union.as_array().unwrap().len(), 1);
    assert!((union[0]["w"].as_f64().unwrap() - 150.0).abs() < 1.0);
    let inter = ok(json!({"op": "shape.merge", "mode": "intersect", "shapes": [a, b]}));
    assert!((inter[0]["w"].as_f64().unwrap() - 50.0).abs() < 1.0, "{inter}");
    let sub = ok(json!({"op": "shape.merge", "mode": "subtract", "shapes": [a, b]}));
    assert!(area(&sub[0]) <= 100.0 * 100.0 + 1.0);
    let frag = ok(json!({"op": "shape.merge", "mode": "fragment", "shapes": [a, b]}));
    assert_eq!(frag.as_array().unwrap().len(), 3);
    let comb = ok(json!({"op": "shape.merge", "mode": "combine", "shapes": [a, b]}));
    assert!(comb[0]["path"].as_str().unwrap().matches('M').count() >= 2, "the overlap is cut out");
    // A rotated star still merges.
    let star = json!({"shape": "star5", "x": 20, "y": 20, "w": 60, "h": 60, "rot": 30});
    assert_eq!(ok(json!({"op": "shape.merge", "mode": "union", "shapes": [a, star]})).as_array().unwrap().len(), 1);
    let path = ok(json!({"op": "shape.toPath", "shape": {"shape": "heart", "x": 0, "y": 0, "w": 100, "h": 80}}));
    assert!(path["path"].as_str().unwrap().contains('C'), "curves are kept for Edit Points");
}

#[test]
fn connectors_glue_to_sites() {
    let a = json!({"shape": "rect", "x": 0, "y": 0, "w": 100, "h": 100});
    let b = json!({"shape": "rect", "x": 300, "y": 0, "w": 100, "h": 100});
    let c = ok(json!({"op": "shape.connect", "from": a, "to": b}));
    assert_eq!(c["x0"], 100.0);
    assert_eq!(c["y0"], 50.0);
    assert_eq!(c["x1"], 300.0);
    assert_eq!(ok(json!({"op": "shape.sites", "shape": a})).as_array().unwrap().len(), 4);
}

#[test]
fn thesaurus_and_picture_catalogs() {
    let t = ok(json!({"op": "review.thesaurus", "word": "Goals"}));
    assert!(!t.as_array().unwrap().is_empty());
    let p = ok(json!({"op": "picture.catalog"}));
    assert_eq!(p["artistic"].as_array().unwrap().len(), 7);
    assert!(p["recolor"].as_array().unwrap().len() >= 19);
}

#[test]
fn text_warp_guides_and_smooth_corners() {
    let cat = ok(json!({"op": "text.warpCatalog"}));
    assert_eq!(cat.as_array().unwrap().len(), 40);
    let arch = ok(json!({"op": "text.warpGuides", "preset": "textArchUp", "w": 400.0, "h": 200.0}));
    assert_eq!(arch["bands"][0]["kind"], "follow");
    let inflate = ok(json!({"op": "text.warpGuides", "preset": "textInflate", "w": 400.0, "h": 200.0}));
    let top = inflate["bands"][0]["top"].as_array().unwrap();
    // Inflate: the top guide bulges up in the middle.
    let mid = top[top.len() / 2][1].as_f64().unwrap();
    let end = top[0][1].as_f64().unwrap();
    assert!(mid < end, "{mid} {end}");
    let sq = ok(json!({"op": "shape.smoothCorners", "w": 200.0, "h": 100.0, "smoothing": 0.6}));
    assert!(sq["path"].as_str().unwrap().contains('C'));
}

#[test]
fn a_custom_scheme_from_a_theme_file_is_used() {
    let s = crate::color::scheme_named(Some("custom:Church|#000000,#ffffff,#1f2a44,#e7e6e6,#c00000,#ed7d31,#a5a5a5,#ffc000,#5b9bd5,#70ad47,#0563c1,#954f72"));
    assert_eq!(s.name, "Church");
    assert_eq!(crate::color::hex(s.colors[4]).to_lowercase(), "#c00000");
}

// ── Chart types beyond column/bar/line/pie ───────────────────────────────────────────────────

fn svg_of(v: Value) -> String {
    let mut req = json!({"op": "chart.svg", "w": 800, "h": 500});
    for (k, x) in v.as_object().unwrap() {
        req[k] = x.clone();
    }
    ok(req)["svg"].as_str().unwrap().to_string()
}

fn count(s: &str, pat: &str) -> usize {
    s.matches(pat).count()
}

const ALL_KINDS: [&str; 27] = [
    "column", "columnStacked", "columnPercent", "bar", "barStacked", "barPercent", "line", "lineMarkers", "lineStacked", "area", "areaStacked", "pie", "doughnut",
    "scatter", "bubble", "radar", "radarFilled", "stock", "surface", "histogram", "pareto", "boxWhisker", "waterfall", "funnel", "treemap", "sunburst", "combo",
];

#[test]
fn every_chart_kind_draws_a_document() {
    for kind in ALL_KINDS {
        let svg = svg_of(json!({"kind": kind, "title": "차트", "categories": ["가", "나", "다", "라"],
            "series": [{"name": "A", "values": [4, 2.5, 3, 5]}, {"name": "B", "values": [2, 4, 1.5, 3]}, {"name": "C", "values": [3, 3, 4, 2]}, {"name": "D", "values": [5, 1, 2, 4]}],
            "dataLabels": true, "upDownBars": true}));
        assert!(svg.starts_with("<svg") && svg.ends_with("</svg>"), "{kind}");
        assert!(svg.contains("차트"), "{kind} keeps its title");
        assert!(!svg.contains("NaN") && !svg.contains("inf"), "{kind} has finite coordinates");
    }
    // Empty and degenerate data never panic.
    for kind in ALL_KINDS {
        let _ = svg_of(json!({"kind": kind, "categories": [], "series": []}));
        let _ = svg_of(json!({"kind": kind, "categories": ["a"], "series": [{"name": "x", "values": [0]}]}));
    }
}

#[test]
fn waterfall_floats_and_totals_stand() {
    let svg = svg_of(json!({"kind": "waterfall", "categories": ["시작", "증가", "감소", "합계"], "series": [{"name": "금액", "values": [100, 50, -30, 120]}],
        "subtotals": [0, 3], "dataLabels": true}));
    // Three connectors (between four bars) and the zero line.
    assert_eq!(count(&svg, "stroke-opacity=\"0.5\""), 3);
    for t in ["증가", "감소", "합계"] {
        assert!(svg.contains(t));
    }
    assert!(svg.contains(">-30<"), "the decrease keeps its sign as a label");
}

#[test]
fn histogram_bins_by_count_and_size() {
    let obs = [1, 2, 2, 3, 4, 5, 9];
    let by_count = svg_of(json!({"kind": "histogram", "categories": [], "series": [{"name": "값", "values": obs}], "binCount": 4, "dataLabels": true, "legend": false}));
    assert!(by_count.contains("[1, 3]") && by_count.contains("(3, 5]"), "bin labels as Excel writes them");
    // 4 bars (counts 4, 2, 0, 1), touching, with a thin white outline.
    assert_eq!(count(&by_count, "stroke=\"#ffffff\" stroke-opacity=\"0.7\""), 4, "the empty bin is a zero-height bar");
    let by_size = svg_of(json!({"kind": "histogram", "categories": [], "series": [{"name": "값", "values": obs}], "binSize": 5, "legend": false}));
    assert_eq!(count(&by_size, "stroke=\"#ffffff\" stroke-opacity=\"0.7\""), 2);
}

#[test]
fn pareto_sorts_bins_and_adds_a_cumulative_line_on_a_percent_axis() {
    let svg = svg_of(json!({"kind": "pareto", "categories": [], "series": [{"name": "값", "values": [1, 2, 2, 3, 4, 5, 9, 9, 9]}], "binCount": 3, "dataLabels": true}));
    assert!(svg.contains("100%") && svg.contains("누적 %"));
    assert!(svg.contains("<circle"), "the cumulative line has markers");
}

#[test]
fn box_whisker_draws_a_box_per_group_and_series() {
    let svg = svg_of(json!({"kind": "boxWhisker", "categories": ["A", "A", "A", "A", "A", "A", "B", "B", "B", "B", "B", "B"],
        "series": [{"name": "s", "values": [1, 2, 3, 4, 5, 6, 10, 11, 12, 13, 14, 90]}], "legend": false}));
    assert_eq!(count(&svg, "fill-opacity=\"0.85\""), 2, "one box per group");
    assert!(count(&svg, "<circle") >= 1, "the 90 is an outlier");
    let inc = svg_of(json!({"kind": "boxWhisker", "inclusiveQuartiles": true, "categories": ["A", "A", "A", "A", "A"], "series": [{"name": "s", "values": [1, 2, 3, 4, 100]}]}));
    let exc = svg_of(json!({"kind": "boxWhisker", "inclusiveQuartiles": false, "categories": ["A", "A", "A", "A", "A"], "series": [{"name": "s", "values": [1, 2, 3, 4, 100]}]}));
    assert_ne!(inc, exc, "the quartile method changes the boxes");
}

#[test]
fn hierarchies_draw_groups_and_leaves() {
    let req = |kind: &str| json!({"kind": kind, "categories": ["1월", "2월", "3월", "4월"], "categoryLevels": [["1분기", "", "", "2분기"]],
        "series": [{"name": "값", "values": [4, 3, 2, 5]}], "dataLabels": true, "legend": false});
    let tm = svg_of(req("treemap"));
    // Two groups and four leaves.
    assert_eq!(count(&tm, "<rect"), 6);
    assert!(tm.contains("1분기") && tm.contains("2분기"));
    let sb = svg_of(req("sunburst"));
    assert_eq!(count(&sb, "<path"), 6, "two groups and four leaves");
    // A flat treemap is one tile per category.
    let flat = svg_of(json!({"kind": "treemap", "categories": ["a", "b", "c"], "series": [{"name": "v", "values": [5, 3, 2]}], "legend": false}));
    assert_eq!(count(&flat, "<rect"), 3);
}

#[test]
fn squarify_tiles_the_area_in_proportion() {
    use crate::chart_ex::{Rect, squarify};
    let area = Rect { x0: 0.0, y0: 0.0, x1: 600.0, y1: 400.0 };
    let tiles = squarify(&[6.0, 6.0, 4.0, 3.0, 2.0, 2.0, 1.0], area);
    let total: f64 = tiles.iter().map(Rect::area).sum();
    assert!((total - 240_000.0).abs() < 1.0, "the tiles cover the area");
    assert!((tiles[0].area() / 240_000.0 - 6.0 / 24.0).abs() < 1e-6, "a tile's share is its value's share");
    assert_eq!(squarify(&[0.0, -1.0], area), vec![Rect::ZERO; 2]);
}

#[test]
fn funnel_radar_stock_surface_bubble_combo() {
    let funnel = svg_of(json!({"kind": "funnel", "categories": ["방문", "가입", "구매"], "series": [{"name": "v", "values": [100, 60, 20]}]}));
    assert_eq!(count(&funnel, "<rect"), 3);
    let radar = svg_of(json!({"kind": "radar", "categories": ["a", "b", "c", "d", "e"], "series": [{"name": "s", "values": [1, 2, 3, 4, 5]}], "legend": false}));
    assert_eq!(count(&radar, "<circle"), 5);
    let filled = svg_of(json!({"kind": "radarFilled", "categories": ["a", "b", "c"], "series": [{"name": "s", "values": [1, 2, 3]}]}));
    assert!(filled.contains("fill-opacity=\"0.55\""));
    assert!(!svg_of(json!({"kind": "radar", "categories": ["a", "b"], "series": [{"name": "s", "values": [1, 2]}], "legend": false})).contains("<path"), "two spokes draw no polygon");
    let hlc = json!({"kind": "stock", "categories": ["월", "화"], "series": [{"name": "고가", "values": [58, 60]}, {"name": "저가", "values": [11, 12]}, {"name": "종가", "values": [43, 40]}]});
    let mut hlc = hlc;
    hlc["gridlines"] = json!(false);
    assert_eq!(count(&svg_of(hlc), "<line"), 5, "a high-low line and a close dash per day, and the zero line");
    let ohlc = json!({"kind": "stock", "upDownBars": true, "categories": ["월", "화"], "series": [{"name": "시가", "values": [20, 40]}, {"name": "고가", "values": [58, 60]}, {"name": "저가", "values": [11, 12]}, {"name": "종가", "values": [43, 30]}]});
    let svg = svg_of(ohlc);
    assert!(svg.contains("fill=\"#ffffff\" stroke") && svg.contains("fill=\"#404040\""), "rose is white, fell is dark");
    let surf = svg_of(json!({"kind": "surface", "categories": ["1", "2", "3"], "series": [{"name": "a", "values": [1, 5, 9]}, {"name": "b", "values": [2, 6, 10]}]}));
    assert!(count(&surf, "<rect") >= 6);
    let bubble = svg_of(json!({"kind": "bubble", "categories": [], "series": [{"name": "s", "values": [3, 5, 2], "xValues": [1, 2, 3], "sizes": [10, 40, 20]}]}));
    assert_eq!(count(&bubble, "fill-opacity=\"0.6\""), 3);
    let combo = svg_of(json!({"kind": "combo", "categories": ["a", "b", "c"],
        "series": [{"name": "매출", "values": [10, 20, 30]}, {"name": "비율", "values": [1, 2, 3], "kind": "lineMarkers", "secondaryAxis": true}]}));
    assert!(count(&combo, "<circle") == 3, "line with markers over columns");
}

#[test]
fn percent_stacks_run_to_one_hundred() {
    let svg = svg_of(json!({"kind": "columnPercent", "categories": ["a", "b"], "series": [{"name": "x", "values": [1, 3]}, {"name": "y", "values": [3, 1]}]}));
    assert!(svg.contains(">100%<") && svg.contains(">0%<"));
    let stacked_area = svg_of(json!({"kind": "areaStacked", "categories": ["a", "b"], "series": [{"name": "x", "values": [1, 3]}, {"name": "y", "values": [3, 1]}]}));
    assert!(stacked_area.contains(">4<"), "the axis reaches the stacked total");
}

#[test]
fn palettes_and_gridlines() {
    let base = json!({"kind": "column", "categories": ["a"], "series": [{"name": "x", "values": [1]}]});
    let colourful = svg_of(base.clone());
    let mut mono = base.clone();
    mono["palette"] = json!("monochrome3");
    assert_ne!(colourful, svg_of(mono), "a monochrome palette uses one accent");
    let mut none = base;
    none["gridlines"] = json!(false);
    assert_eq!(count(&svg_of(none), "stroke-opacity=\"0.25\""), 0);
    assert!(count(&colourful, "stroke-opacity=\"0.25\"") > 0);
}
