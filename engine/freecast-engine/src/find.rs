//! Home › Editing › Find and Replace across a presentation: match case, whole words only (Hangul,
//! letters and digits are word characters). Offsets are UTF-16 code units, as JavaScript counts.

use serde::Deserialize;
use serde_json::json;

use crate::Res;

#[derive(Deserialize, Clone)]
pub struct Item {
    /// Caller's id for this piece of text (slide, object, field).
    pub key: String,
    pub text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchReq {
    pub items: Vec<Item>,
    pub query: String,
    #[serde(default)]
    pub match_case: bool,
    #[serde(default)]
    pub whole_word: bool,
}

fn word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

fn fold(c: char, match_case: bool) -> char {
    if match_case { c } else { c.to_lowercase().next().unwrap_or(c) }
}

/// Matches of `q` in `text` as char index ranges.
pub fn find_all(text: &str, q: &str, match_case: bool, whole_word: bool) -> Vec<(usize, usize)> {
    let t: Vec<char> = text.chars().collect();
    let p: Vec<char> = q.chars().map(|c| fold(c, match_case)).collect();
    let mut out = vec![];
    if p.is_empty() || p.len() > t.len() {
        return out;
    }
    let mut i = 0;
    while i + p.len() <= t.len() {
        let hit = p.iter().enumerate().all(|(k, c)| fold(t[i + k], match_case) == *c);
        let bounded = !whole_word || ((i == 0 || !word_char(t[i - 1])) && (i + p.len() == t.len() || !word_char(t[i + p.len()])));
        if hit && bounded {
            out.push((i, i + p.len()));
            i += p.len();
        } else {
            i += 1;
        }
    }
    out
}

/// UTF-16 offset of char index `ci` in `text`.
fn utf16_at(text: &str, ci: usize) -> usize {
    text.chars().take(ci).map(char::len_utf16).sum()
}

/// `[{key, start, end}]` (UTF-16 offsets) in item order.
pub fn search(r: SearchReq) -> Res {
    let mut out = vec![];
    for it in &r.items {
        for (a, b) in find_all(&it.text, &r.query, r.match_case, r.whole_word) {
            out.push(json!({ "key": it.key, "start": utf16_at(&it.text, a), "end": utf16_at(&it.text, b) }));
        }
    }
    Ok(json!(out))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceReq {
    pub items: Vec<Item>,
    pub query: String,
    pub replacement: String,
    #[serde(default)]
    pub match_case: bool,
    #[serde(default)]
    pub whole_word: bool,
    /// Replace only this match (Replace); none = every match (Replace All).
    #[serde(default)]
    pub only_key: Option<String>,
    /// UTF-16 start of the one match to replace.
    #[serde(default)]
    pub only_start: Option<usize>,
}

/// `{count, items: [{key, text}]}` with only the changed items.
pub fn replace(r: ReplaceReq) -> Res {
    let mut count = 0;
    let mut changed = vec![];
    for it in &r.items {
        if r.only_key.as_ref().is_some_and(|k| *k != it.key) {
            continue;
        }
        let hits = find_all(&it.text, &r.query, r.match_case, r.whole_word);
        let chars: Vec<char> = it.text.chars().collect();
        let mut out = String::new();
        let mut last = 0;
        let mut n = 0;
        for (a, b) in hits {
            if let Some(start) = r.only_start
                && utf16_at(&it.text, a) != start
            {
                continue;
            }
            out.extend(&chars[last..a]);
            out.push_str(&r.replacement);
            last = b;
            n += 1;
        }
        if n > 0 {
            out.extend(&chars[last..]);
            count += n;
            changed.push(json!({ "key": it.key, "text": out }));
        }
    }
    Ok(json!({ "count": count, "items": changed }))
}
