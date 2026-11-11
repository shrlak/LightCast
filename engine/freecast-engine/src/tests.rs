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
