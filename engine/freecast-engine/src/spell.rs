//! From DeckCraft (`crates/engine/src/spell.rs`, MIT OR Apache-2.0): the Hunspell-format
//! dictionary (parse, add_word, check, suggest, word_chars) unchanged; DeckCraft's search of the
//! system's dictionary folders and its user-dictionary file are left out — FreeCast hands the
//! engine the `.aff`/`.dic` texts it ships (public/dict) and keeps the user's words itself.
//!
//! Spell checking with Hunspell-format dictionaries (`xx_YY.aff` + `xx_YY.dic`).
//!
//! A subset of Hunspell: `SET` (UTF-8 and ISO-8859-1), `FLAG` (default, `long`, `num`, `UTF-8`),
//! `PFX`/`SFX` with strip, conditions and cross products, continuation flags on affixes (one
//! level: a suffix that allows a further suffix), `NEEDAFFIX`, `FORBIDDENWORD`, `NOSUGGEST`,
//! `KEEPCASE`, `TRY`, `REP` and `WORDCHARS`, and simple compounding (`COMPOUNDFLAG`, begin, middle
//! and end flags, `COMPOUNDMIN`). `ICONV`/`OCONV`, compound rules and morphology are not read;
//! words they would accept are reported as misspelt.
//!
//! Engine ops (FreeCast): `spell.load`, `spell.loaded`, `spell.check`, `spell.suggest` and
//! `spell.addWord` — see [`load`] and below.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};

use serde::Deserialize;
use serde_json::json;

use crate::Res;

type Flag = u32;

#[derive(Clone, Copy, Debug, PartialEq)]
enum FlagMode {
    Char,
    Long,
    Num,
}

#[derive(Clone, Debug)]
enum Cond {
    Any,
    Is(char),
    In(Vec<char>, bool),
}

impl Cond {
    fn matches(&self, c: char) -> bool {
        match self {
            Cond::Any => true,
            Cond::Is(x) => *x == c,
            Cond::In(set, neg) => set.contains(&c) != *neg,
        }
    }
}

fn parse_cond(s: &str) -> Vec<Cond> {
    let mut out = vec![];
    let mut it = s.chars();
    while let Some(c) = it.next() {
        match c {
            '.' => out.push(Cond::Any),
            '[' => {
                let mut set = vec![];
                let mut neg = false;
                for (i, d) in it.by_ref().enumerate() {
                    if d == ']' {
                        break;
                    }
                    if i == 0 && d == '^' {
                        neg = true;
                    } else {
                        set.push(d);
                    }
                }
                out.push(Cond::In(set, neg));
            }
            c => out.push(Cond::Is(c)),
        }
    }
    out
}

#[derive(Clone, Debug)]
struct Affix {
    flag: Flag,
    cross: bool,
    strip: String,
    add: String,
    cond: Vec<Cond>,
    cont: Vec<Flag>,
}

impl Affix {
    /// Prefix: does `root` start with the condition? Suffix: does it end with it?
    fn cond_ok(&self, root: &[char], prefix: bool) -> bool {
        if self.cond.len() > root.len() {
            return false;
        }
        if prefix {
            self.cond.iter().zip(root).all(|(c, r)| c.matches(*r))
        } else {
            self.cond.iter().rev().zip(root.iter().rev()).all(|(c, r)| c.matches(*r))
        }
    }
}

/// A loaded dictionary.
#[derive(Debug, Default)]
pub struct Dictionary {
    words: HashMap<String, Vec<Vec<Flag>>>,
    pfx: Vec<Affix>,
    sfx: Vec<Affix>,
    try_chars: Vec<char>,
    rep: Vec<(String, String)>,
    word_chars: Vec<char>,
    forbidden: Option<Flag>,
    need_affix: Option<Flag>,
    no_suggest: Option<Flag>,
    keep_case: Option<Flag>,
    only_in_compound: Option<Flag>,
    compound: Option<Flag>,
    compound_begin: Option<Flag>,
    compound_middle: Option<Flag>,
    compound_end: Option<Flag>,
    compound_min: usize,
    compound_max: usize,
}

fn decode(bytes: &[u8], latin1: bool) -> String {
    if latin1 { bytes.iter().map(|b| char::from(*b)).collect() } else { String::from_utf8_lossy(bytes).into_owned() }
}

fn parse_flags(s: &str, mode: FlagMode) -> Vec<Flag> {
    match mode {
        FlagMode::Char => s.chars().map(|c| c as u32).collect(),
        FlagMode::Long => {
            let c: Vec<char> = s.chars().collect();
            c.chunks(2).map(|p| p.iter().fold(0u32, |a, c| a.wrapping_mul(0x11_0000).wrapping_add(*c as u32))).collect()
        }
        FlagMode::Num => s.split(',').filter_map(|n| n.trim().parse().ok()).collect(),
    }
}

fn one_flag(s: Option<&str>, mode: FlagMode) -> Option<Flag> {
    s.and_then(|s| parse_flags(s, mode).first().copied())
}

impl Dictionary {
    /// Parse a dictionary from the bytes of its `.aff` and `.dic` files.
    pub fn parse(aff: &[u8], dic: &[u8]) -> Dictionary {
        let head = String::from_utf8_lossy(aff);
        let latin1 = head.lines().any(|l| {
            let mut w = l.split_whitespace();
            w.next() == Some("SET") && w.next().is_some_and(|e| e.to_ascii_uppercase().replace('-', "").starts_with("ISO8859"))
        });
        let aff = decode(aff, latin1);
        let mode = aff
            .lines()
            .find_map(|l| {
                let mut w = l.split_whitespace();
                (w.next() == Some("FLAG")).then(|| match w.next() {
                    Some("long") => FlagMode::Long,
                    Some("num") => FlagMode::Num,
                    _ => FlagMode::Char,
                })
            })
            .unwrap_or(FlagMode::Char);
        let mut d = Dictionary { compound_min: 3, ..Dictionary::default() };
        let mut lines = aff.lines().map(|l| l.split('#').next().unwrap_or("")).peekable();
        while let Some(l) = lines.next() {
            let w: Vec<&str> = l.split_whitespace().collect();
            match w.as_slice() {
                ["TRY", s, ..] => d.try_chars = s.chars().collect(),
                ["WORDCHARS", s, ..] => d.word_chars = s.chars().collect(),
                ["FORBIDDENWORD", f, ..] => d.forbidden = one_flag(Some(f), mode),
                ["NEEDAFFIX", f, ..] | ["PSEUDOROOT", f, ..] => d.need_affix = one_flag(Some(f), mode),
                ["NOSUGGEST", f, ..] => d.no_suggest = one_flag(Some(f), mode),
                ["KEEPCASE", f, ..] => d.keep_case = one_flag(Some(f), mode),
                ["ONLYINCOMPOUND", f, ..] => d.only_in_compound = one_flag(Some(f), mode),
                ["COMPOUNDFLAG", f, ..] => d.compound = one_flag(Some(f), mode),
                ["COMPOUNDBEGIN", f, ..] => d.compound_begin = one_flag(Some(f), mode),
                ["COMPOUNDMIDDLE", f, ..] => d.compound_middle = one_flag(Some(f), mode),
                ["COMPOUNDEND", f, ..] | ["COMPOUNDLAST", f, ..] => d.compound_end = one_flag(Some(f), mode),
                ["COMPOUNDMIN", n, ..] => d.compound_min = n.parse::<usize>().unwrap_or(3).max(1),
                ["COMPOUNDWORDMAX", n, ..] => d.compound_max = n.parse().unwrap_or(0),
                ["REP", n] => {
                    for _ in 0..n.parse::<usize>().unwrap_or(0) {
                        // The count is the file's claim: stop when the records run out.
                        let Some(line) = lines.next() else { break };
                        let r: Vec<&str> = line.split_whitespace().collect();
                        if let [_, a, b, ..] = r.as_slice() {
                            d.rep.push((a.replace('_', " "), b.replace('_', " ")));
                        }
                    }
                }
                [kind @ ("PFX" | "SFX"), flag, cross, n] if n.parse::<usize>().is_ok() => {
                    let prefix = *kind == "PFX";
                    let Some(flag) = one_flag(Some(flag), mode) else { continue };
                    let cross = cross.eq_ignore_ascii_case("y");
                    for _ in 0..n.parse::<usize>().unwrap_or(0) {
                        let Some(line) = lines.next() else { break };
                        let r: Vec<&str> = line.split_whitespace().collect();
                        let [_, _, strip, add, rest @ ..] = r.as_slice() else { continue };
                        let (add, cont) = match add.split_once('/') {
                            Some((a, c)) => (a, parse_flags(c, mode)),
                            None => (*add, vec![]),
                        };
                        let a = Affix {
                            flag,
                            cross,
                            strip: if *strip == "0" { String::new() } else { strip.to_string() },
                            add: if add == "0" { String::new() } else { add.to_string() },
                            cond: parse_cond(rest.first().copied().unwrap_or(".")),
                            cont,
                        };
                        if prefix { d.pfx.push(a) } else { d.sfx.push(a) }
                    }
                }
                _ => {}
            }
        }
        let dic = decode(dic, latin1);
        for (i, l) in dic.lines().enumerate() {
            if i == 0 && l.trim().parse::<usize>().is_ok() {
                continue;
            }
            let entry = l.split(['\t']).next().unwrap_or("").trim_end();
            // Morphological fields follow a space (`word/flags po:noun`).
            let entry = entry.split(' ').next().unwrap_or("");
            if entry.is_empty() {
                continue;
            }
            let (word, flags) = match entry.split_once('/') {
                Some((w, f)) if !w.is_empty() => (w, parse_flags(f, mode)),
                _ => (entry, vec![]),
            };
            d.words.entry(word.to_string()).or_default().push(flags);
        }
        d
    }

    /// Add `word` (no flags), as a user's own dictionary entry.
    pub fn add_word(&mut self, word: &str) {
        self.words.entry(word.to_string()).or_default().push(vec![]);
    }

    fn has(&self, flags: &[Flag], f: Option<Flag>) -> bool {
        f.is_some_and(|f| flags.contains(&f))
    }

    /// `word` as a root carrying all of `need` (and not forbidden).
    fn root(&self, word: &str, need: &[Flag], affixed: bool) -> bool {
        self.words.get(word).is_some_and(|hs| {
            hs.iter().any(|f| {
                !self.has(f, self.forbidden)
                    && (affixed || !self.has(f, self.need_affix))
                    && !self.has(f, self.only_in_compound)
                    && need.iter().all(|n| f.contains(n))
            })
        })
    }

    fn forbidden_word(&self, word: &str) -> bool {
        self.words.get(word).is_some_and(|hs| hs.iter().any(|f| self.has(f, self.forbidden)))
    }

    /// Strip suffixes from `w` (one, or two through continuation flags); `extra` flags must also be
    /// on the root, `cross` means the suffix must allow a prefix.
    fn suffixed(&self, w: &[char], extra: &[Flag], cross: bool) -> bool {
        for s in &self.sfx {
            if cross && !s.cross {
                continue;
            }
            let Some(stem) = strip_end(w, &s.add, &s.strip) else { continue };
            if !s.cond_ok(&stem, false) {
                continue;
            }
            let root: String = stem.iter().collect();
            let mut need = extra.to_vec();
            need.push(s.flag);
            if self.root(&root, &need, true) {
                return true;
            }
            // A second suffix whose continuation allows this one (`walk/A` + `ing/B`…).
            for s2 in &self.sfx {
                if !s.cont.is_empty() || !s2.cont.contains(&s.flag) {
                    continue;
                }
                let Some(stem2) = strip_end(&stem, &s2.add, &s2.strip) else { continue };
                if s2.cond_ok(&stem2, false) {
                    let mut need = extra.to_vec();
                    need.push(s2.flag);
                    if self.root(&stem2.iter().collect::<String>(), &need, true) {
                        return true;
                    }
                }
            }
        }
        false
    }

    /// A root (or, for the last part, a suffixed root) carrying `flag`, as a compound part.
    fn compound_part(&self, part: &[char], flag: Flag, last: bool) -> bool {
        let word: String = part.iter().collect();
        let ok = self.words.get(&word).is_some_and(|hs| hs.iter().any(|f| !self.has(f, self.forbidden) && f.contains(&flag)));
        ok || (last && self.suffixed_compound_end(part, flag))
    }

    /// The last part of a compound with a suffix: the root must carry the compound `flag`.
    fn suffixed_compound_end(&self, w: &[char], flag: Flag) -> bool {
        self.sfx.iter().any(|s| {
            strip_end(w, &s.add, &s.strip).is_some_and(|stem| {
                s.cond_ok(&stem, false)
                    && self
                        .words
                        .get(&stem.iter().collect::<String>())
                        .is_some_and(|hs| hs.iter().any(|f| !self.has(f, self.forbidden) && f.contains(&flag) && f.contains(&s.flag)))
            })
        })
    }

    /// `w` made of dictionary parts allowed in compounds (`COMPOUNDFLAG`, or the begin, middle and
    /// end flags), each at least `COMPOUNDMIN` characters long.
    fn compounded(&self, w: &[char], index: usize, failed: &mut HashSet<(usize, usize)>) -> bool {
        // `w` is always a tail of the checked word, so its length names it: a (tail, part index)
        // that failed once fails again however the earlier parts were split.
        if failed.contains(&(w.len(), index)) {
            return false;
        }
        if self.compound.is_none() && self.compound_end.is_none() {
            return false;
        }
        let min = self.compound_min.max(1);
        if index >= 8 || (self.compound_max > 0 && index + 1 >= self.compound_max) || w.len() < 2 * min {
            return false;
        }
        let role = if index == 0 { self.compound_begin } else { self.compound_middle };
        for i in min..=w.len() - min {
            let (head, rest) = w.split_at(i);
            let head_ok = [self.compound, role].into_iter().flatten().any(|f| self.compound_part(head, f, false));
            if !head_ok {
                continue;
            }
            if [self.compound, self.compound_end].into_iter().flatten().any(|f| self.compound_part(rest, f, true)) {
                return true;
            }
            if self.compounded(rest, index + 1, failed) {
                return true;
            }
        }
        failed.insert((w.len(), index));
        false
    }

    fn check_exact(&self, word: &str) -> bool {
        if self.forbidden_word(word) {
            return false;
        }
        if self.root(word, &[], false) {
            return true;
        }
        let w: Vec<char> = word.chars().collect();
        if self.suffixed(&w, &[], false) {
            return true;
        }
        for p in &self.pfx {
            let Some(stem) = strip_start(&w, &p.add, &p.strip) else { continue };
            if !p.cond_ok(&stem, true) {
                continue;
            }
            if self.root(&stem.iter().collect::<String>(), &[p.flag], true) {
                return true;
            }
            if p.cross && self.suffixed(&stem, &[p.flag], true) {
                return true;
            }
        }
        self.compounded(&w, 0, &mut HashSet::new())
    }

    /// Is `word` spelt correctly? Capitalised and upper-case forms of a lower-case word pass.
    /// Words longer than 100 characters are not checked (they pass).
    pub fn check(&self, word: &str) -> bool {
        // Compound splitting tries every split point, so checking costs O(n²) in the word's
        // length: a 100,000-character "word" took seconds per check under a compounding
        // dictionary, on every edit (#1175).
        if word.chars().nth(MAX_CHECK_CHARS).is_some() {
            return true;
        }
        if word.contains('\u{2019}') {
            return self.check(&word.replace('\u{2019}', "'"));
        }
        if word.is_empty() || word.chars().all(|c| !c.is_alphabetic()) {
            return true;
        }
        if self.check_exact(word) {
            return true;
        }
        let lower = word.to_lowercase();
        let upper_tail = word.chars().skip(1).all(|c| !c.is_lowercase());
        let cap_only = word.chars().next().is_some_and(char::is_uppercase) && word.chars().skip(1).all(|c| !c.is_uppercase());
        let keep = |w: &str| self.words.get(w).is_some_and(|hs| hs.iter().any(|f| self.has(f, self.keep_case)));
        if (cap_only || upper_tail) && !keep(&lower) && self.check_exact(&lower) {
            return true;
        }
        if upper_tail && !cap_only {
            let cap = capitalise(&lower);
            if !keep(&cap) && self.check_exact(&cap) {
                return true;
            }
        }
        // A trailing full stop on an abbreviation (`etc.`) is part of the word in some dictionaries.
        false
    }

    fn suggestible(&self, w: &str) -> bool {
        self.check(w) && !self.words.get(w).is_some_and(|hs| hs.iter().all(|f| self.has(f, self.no_suggest) && !f.is_empty()))
    }

    /// Up to `n` corrections for a misspelt `word`, best first.
    pub fn suggest(&self, word: &str, n: usize) -> Vec<String> {
        // Edit-distance candidates grow with the word: nothing is suggested for a run-on token.
        if word.chars().count() > MAX_SUGGEST_CHARS {
            return vec![];
        }
        let cap = word.chars().next().is_some_and(char::is_uppercase);
        let upper = word.chars().count() > 1 && word.chars().any(char::is_uppercase) && !word.chars().any(char::is_lowercase);
        let lower = if upper || (cap && word.chars().skip(1).all(|c| !c.is_uppercase())) { word.to_lowercase() } else { word.to_string() };
        let w: Vec<char> = lower.chars().collect();
        let mut out: Vec<String> = vec![];
        let mut seen = HashSet::new();
        let mut push = |s: String, out: &mut Vec<String>| {
            if s == lower {
                return;
            }
            // Checked in capitals, so a KEEPCASE entry ("NASA") is offered for an all-caps word.
            let s = if upper { s.to_uppercase() } else { s };
            if seen.insert(s.to_lowercase()) && s.split(' ').all(|p| self.suggestible(p)) {
                out.push(s);
            }
        };
        for (a, b) in &self.rep {
            let mut from = 0;
            while let Some(i) = lower.get(from..).and_then(|t| t.find(a.as_str())) {
                let at = from + i;
                push(format!("{}{}{}", &lower[..at], b, &lower[at + a.len()..]), &mut out);
                from = at + a.len().max(1);
            }
        }
        let try_chars: Vec<char> = if self.try_chars.is_empty() { "esianrtolcdugmphbyfvkwzxjq".chars().collect() } else { self.try_chars.clone() };
        let s = |v: &[char]| v.iter().collect::<String>();
        for i in 0..w.len().saturating_sub(1) {
            let mut v = w.clone();
            v.swap(i, i + 1);
            push(s(&v), &mut out);
        }
        for i in 0..w.len() {
            let mut v = w.clone();
            v.remove(i);
            push(s(&v), &mut out);
        }
        for i in 0..w.len() {
            for c in &try_chars {
                if *c != w[i] {
                    let mut v = w.clone();
                    v[i] = *c;
                    push(s(&v), &mut out);
                }
            }
        }
        for i in 0..=w.len() {
            for c in &try_chars {
                let mut v = w.clone();
                v.insert(i, *c);
                push(s(&v), &mut out);
            }
        }
        for i in 1..w.len() {
            push(format!("{} {}", s(&w[..i]), s(&w[i..])), &mut out);
        }
        out.truncate(n);
        if cap && !upper {
            out = out.into_iter().map(|x| capitalise(&x)).collect();
        }
        out
    }

    /// Characters that belong inside words besides letters and digits (the `WORDCHARS` list).
    pub fn word_chars(&self) -> &[char] {
        &self.word_chars
    }
}

fn capitalise(s: &str) -> String {
    let mut c = s.chars();
    c.next().map(|f| f.to_uppercase().chain(c).collect()).unwrap_or_default()
}

fn strip_end(w: &[char], add: &str, strip: &str) -> Option<Vec<char>> {
    let add: Vec<char> = add.chars().collect();
    if w.len() <= add.len() && strip.is_empty() || !w.ends_with(&add) {
        return None;
    }
    let mut v = w.get(..w.len() - add.len())?.to_vec();
    v.extend(strip.chars());
    (!v.is_empty()).then_some(v)
}

fn strip_start(w: &[char], add: &str, strip: &str) -> Option<Vec<char>> {
    let add: Vec<char> = add.chars().collect();
    if w.len() <= add.len() && strip.is_empty() || !w.starts_with(&add) {
        return None;
    }
    let mut v: Vec<char> = strip.chars().collect();
    v.extend_from_slice(w.get(add.len()..)?);
    (!v.is_empty()).then_some(v)
}


/// Longest word `Dictionary::suggest` generates corrections for.
const MAX_SUGGEST_CHARS: usize = 64;

/// Longest word `Dictionary::check` checks, as Hunspell's word length limit.
const MAX_CHECK_CHARS: usize = 100;

// ── FreeCast: dictionaries by language, loaded from the app's own files ──────────────────────

/// A dictionary and the letters its words are made of: a word with any other letter (Hangul
/// against en_US) is another language's, and is not judged by it.
struct Loaded {
    dict: Dictionary,
    letters: HashSet<char>,
}

impl Loaded {
    fn new(dict: Dictionary) -> Loaded {
        let mut letters: HashSet<char> = dict.words.keys().flat_map(|w| w.chars()).filter(|c| c.is_alphabetic()).collect();
        letters.extend(dict.try_chars.iter().filter(|c| c.is_alphabetic()));
        let cased: Vec<char> = letters.iter().flat_map(|c| c.to_uppercase().chain(c.to_lowercase())).collect();
        letters.extend(cased);
        Loaded { dict, letters }
    }

    /// Is `word` written in this dictionary's letters (or plain Latin ones)?
    fn covers(&self, word: &str) -> bool {
        word.chars().filter(|c| c.is_alphabetic()).all(|c| c.is_ascii_alphabetic() || self.letters.contains(&c))
    }
}

thread_local! {
    static DICTS: RefCell<HashMap<String, Loaded>> = RefCell::new(HashMap::new());
}

/// The dictionary's key: `en-US`, `en_us` and `en_US` are one language.
fn key(lang: &str) -> String {
    lang.trim().replace('-', "_").to_lowercase()
}

/// Install `d` under `lang` (replacing one already there); returns its number of entries.
pub fn install(lang: &str, d: Dictionary) -> usize {
    let n = d.words.len();
    DICTS.with(|m| m.borrow_mut().insert(key(lang), Loaded::new(d)));
    n
}

#[derive(Deserialize)]
pub struct LoadArgs {
    pub lang: String,
    pub aff: String,
    pub dic: String,
}

/// `spell.load { lang, aff, dic }` → `{ ok: true, words }`.
pub fn load(a: LoadArgs) -> Res {
    let n = install(&a.lang, Dictionary::parse(a.aff.as_bytes(), a.dic.as_bytes()));
    Ok(json!({ "ok": true, "words": n }))
}

/// `spell.loaded {}` → the languages loaded, as keys (`en_us`).
pub fn loaded() -> Res {
    let mut v: Vec<String> = DICTS.with(|m| m.borrow().keys().cloned().collect());
    v.sort();
    Ok(json!(v))
}

#[derive(Deserialize)]
pub struct CheckArgs {
    pub lang: String,
    #[serde(default)]
    pub words: Vec<String>,
}

/// Indexes of the misspelt words of `words`. Words with letters the dictionary doesn't have
/// (another script) are not reported.
pub fn misspelt(lang: &str, words: &[String]) -> Result<Vec<usize>, String> {
    DICTS.with(|m| {
        let m = m.borrow();
        let d = m.get(&key(lang)).ok_or_else(|| format!("no dictionary for {lang}"))?;
        Ok(words.iter().enumerate().filter(|(_, w)| d.covers(w) && !d.dict.check(w)).map(|(i, _)| i).collect())
    })
}

/// `spell.check { lang, words }` → `{ bad: [index…] }`.
pub fn check(a: CheckArgs) -> Res {
    Ok(json!({ "bad": misspelt(&a.lang, &a.words)? }))
}

#[derive(Deserialize)]
pub struct SuggestArgs {
    pub lang: String,
    pub word: String,
    #[serde(default = "five")]
    pub n: usize,
}
fn five() -> usize {
    5
}

/// `spell.suggest { lang, word, n }` → up to `n` corrections, best first.
pub fn suggest(a: SuggestArgs) -> Res {
    DICTS.with(|m| {
        let m = m.borrow();
        let d = m.get(&key(&a.lang)).ok_or_else(|| format!("no dictionary for {}", a.lang))?;
        Ok(json!(d.dict.suggest(&a.word, a.n.min(50))))
    })
}

#[derive(Deserialize)]
pub struct AddArgs {
    pub lang: String,
    pub word: String,
}

/// `spell.addWord { lang, word }`: a word of the user's own dictionary, for this session (the app
/// keeps the list and sends it again after a reload).
pub fn add_word(a: AddArgs) -> Res {
    let w = a.word.trim();
    if w.is_empty() {
        return Ok(json!(false));
    }
    DICTS.with(|m| {
        let mut m = m.borrow_mut();
        let d = m.get_mut(&key(&a.lang)).ok_or_else(|| format!("no dictionary for {}", a.lang))?;
        d.dict.add_word(w);
        d.letters.extend(w.chars().filter(|c| c.is_alphabetic()));
        Ok(json!(true))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // A miniature dictionary in Hunspell format (after DeckCraft's test dictionary).
    const AFF: &str = "SET UTF-8\nTRY esianrtolcdugmphbyfvkwzxjq\nFORBIDDENWORD !\nNEEDAFFIX ?\nKEEPCASE K\n\
REP 1\nREP f ph\n\
PFX U Y 1\nPFX U 0 un .\n\
SFX S Y 2\nSFX S y ies [^aeiou]y\nSFX S 0 s [^y]\n\
SFX G Y 2\nSFX G e ing e\nSFX G 0 ing [^e]\n\
SFX D Y 1\nSFX D 0 ed/S .\n";
    const DIC: &str = "11\nslide/S\nmake/G\nhappy\ncity/S\ndo/U\nwork/USG\nphoto/S\nNASA/K\nfoo/?S\nwalk/GS\nwalks/!\n";

    fn d() -> Dictionary {
        Dictionary::parse(AFF.as_bytes(), DIC.as_bytes())
    }

    #[test]
    fn suffix_with_a_condition() {
        let d = d();
        assert!(d.check("cities") && d.check("slides") && d.check("making"));
        assert!(!d.check("citys") && !d.check("makeing") && !d.check("slidez"));
    }

    #[test]
    fn prefix_and_cross_product() {
        let d = d();
        assert!(d.check("undo") && d.check("unworks") && d.check("unworking"));
        assert!(!d.check("unslide") && !d.check("unmaking"));
    }

    #[test]
    fn needaffix_forbidden_and_keepcase() {
        let d = d();
        assert!(!d.check("foo") && d.check("foos"), "NEEDAFFIX: only with an affix");
        assert!(d.check("walking") && !d.check("walks"), "FORBIDDENWORD");
        assert!(d.check("NASA") && !d.check("Nasa") && !d.check("nasa"), "KEEPCASE");
    }

    #[test]
    fn a_capitalised_sentence_start_passes() {
        let d = d();
        assert!(d.check("Slide") && d.check("Happy") && d.check("SLIDES"));
    }

    #[test]
    fn suggestions_from_rep_and_try() {
        let d = d();
        assert!(d.suggest("foto", 5).contains(&"photo".to_string()), "REP f → ph");
        assert_eq!(d.suggest("sldie", 3).first().map(String::as_str), Some("slide"));
        assert!(d.suggest("hapy", 5).contains(&"happy".to_string()), "TRY letter inserted");
        assert!(d.suggest("Slidse", 5).contains(&"Slides".to_string()));
    }

    #[test]
    fn ops_load_check_suggest_and_add() {
        let r = crate::handle(&json!({"op": "spell.load", "lang": "xx-TEST", "aff": AFF, "dic": DIC})).unwrap();
        assert_eq!(r["words"], 11);
        let l = crate::handle(&json!({"op": "spell.loaded"})).unwrap();
        assert!(l.as_array().unwrap().iter().any(|v| v == "xx_test"));
        // Hangul isn't this dictionary's script: not judged. "slidez" and "Fooo" are.
        let c = crate::handle(&json!({"op": "spell.check", "lang": "xx_TEST", "words": ["slides", "slidez", "은혜", "Fooo", "Happy"]})).unwrap();
        assert_eq!(c["bad"], json!([1, 3]));
        let s = crate::handle(&json!({"op": "spell.suggest", "lang": "xx-TEST", "word": "foto", "n": 3})).unwrap();
        assert!(s.as_array().unwrap().iter().any(|v| v == "photo"));
        crate::handle(&json!({"op": "spell.addWord", "lang": "xx-TEST", "word": "slidez"})).unwrap();
        let c = crate::handle(&json!({"op": "spell.check", "lang": "xx-TEST", "words": ["slidez"]})).unwrap();
        assert_eq!(c["bad"], json!([]));
        assert!(crate::handle(&json!({"op": "spell.check", "lang": "zz", "words": ["a"]})).is_err());
    }
}
