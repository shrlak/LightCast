//! From DeckCraft (`crates/engine/src/thesaurus.rs` and `data/thesaurus.txt`, MIT OR Apache-2.0).
//!
//! Review › Thesaurus: synonyms from a small built-in English word list (`data/thesaurus.txt`),
//! looked up offline so it works in the browser build too.

const DATA: &str = include_str!("../data/thesaurus.txt");

/// One sense of a word: its headword and synonyms.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Sense {
    pub word: String,
    pub synonyms: Vec<String>,
}

fn senses_of(head: &str) -> Vec<Sense> {
    DATA.lines()
        .filter(|l| !l.starts_with('#'))
        .filter_map(|l| l.split_once('|'))
        .filter(|(h, _)| h.trim() == head)
        .map(|(h, s)| Sense { word: h.trim().to_string(), synonyms: s.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect() })
        .collect()
}

/// The senses for `word`, trying simple English endings when the word itself isn't listed
/// ("goals" → "goal", "improved" → "improve", "growing" → "grow"). Synonyms take the word's
/// capitalisation ("Goal" → "Aim", "GOAL" → "AIM").
pub fn lookup(word: &str) -> Vec<Sense> {
    let w: String = word.trim().trim_matches(|c: char| !c.is_alphanumeric() && c != '-').chars().take(64).collect();
    let lower = w.to_lowercase();
    if lower.is_empty() {
        return vec![];
    }
    let mut tries = vec![lower.clone()];
    for (suffix, add) in [("ies", "y"), ("es", ""), ("s", ""), ("ied", "y"), ("ed", "e"), ("ed", ""), ("ing", "e"), ("ing", "")] {
        if let Some(stem) = lower.strip_suffix(suffix)
            && stem.chars().count() >= 2
        {
            tries.push(format!("{stem}{add}"));
        }
    }
    let Some(found) = tries.iter().map(|t| senses_of(t)).find(|v| !v.is_empty()) else { return vec![] };
    let upper = w.chars().count() > 1 && w.chars().all(|c| !c.is_lowercase());
    let title = !upper && w.chars().next().is_some_and(char::is_uppercase);
    found
        .into_iter()
        .map(|s| Sense {
            word: s.word,
            synonyms: s
                .synonyms
                .into_iter()
                .map(|x| {
                    if upper {
                        x.to_uppercase()
                    } else if title {
                        let mut c = x.chars();
                        c.next().map(|f| f.to_uppercase().chain(c).collect()).unwrap_or_default()
                    } else {
                        x
                    }
                })
                .collect(),
        })
        .collect()
}


/// `[{word, synonyms}]` for `word`.
pub fn op(req: &serde_json::Value) -> crate::Res {
    let word = req.get("word").and_then(serde_json::Value::as_str).unwrap_or("");
    crate::to_value(lookup(word))
}
