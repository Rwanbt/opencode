//! Grapheme-to-Phoneme converter for Kokoro TTS.
//! Uses CMUDict for English, simple IPA rules for French.

use std::collections::HashMap;
use std::sync::OnceLock;

static CMUDICT: OnceLock<HashMap<String, String>> = OnceLock::new();

/// ARPABET → IPA mapping
fn arpa_to_ipa(arpa: &str) -> String {
    let map: &[(&str, &str)] = &[
        ("AA", "ɑ"), ("AE", "æ"), ("AH", "ə"), ("AO", "ɔ"), ("AW", "aʊ"),
        ("AY", "aɪ"), ("B", "b"), ("CH", "tʃ"), ("D", "d"), ("DH", "ð"),
        ("EH", "ɛ"), ("ER", "ɝ"), ("EY", "eɪ"), ("F", "f"), ("G", "ɡ"),
        ("HH", "h"), ("IH", "ɪ"), ("IY", "i"), ("JH", "dʒ"), ("K", "k"),
        ("L", "l"), ("M", "m"), ("N", "n"), ("NG", "ŋ"), ("OW", "oʊ"),
        ("OY", "ɔɪ"), ("P", "p"), ("R", "ɹ"), ("S", "s"), ("SH", "ʃ"),
        ("T", "t"), ("TH", "θ"), ("UH", "ʊ"), ("UW", "u"), ("V", "v"),
        ("W", "w"), ("Y", "j"), ("Z", "z"), ("ZH", "ʒ"),
    ];

    // Parse "PHONEME0" or "PHONEME" (with optional stress digit)
    let (phone, stress) = if arpa.ends_with(|c: char| c.is_ascii_digit()) {
        let (p, s) = arpa.split_at(arpa.len() - 1);
        (p, s)
    } else {
        (arpa, "")
    };

    let ipa = map.iter()
        .find(|(a, _)| *a == phone)
        .map(|(_, i)| *i)
        .unwrap_or("");

    let stress_mark = match stress {
        "1" => "ˈ",
        "2" => "ˌ",
        _ => "",
    };

    format!("{}{}", stress_mark, ipa)
}

fn load_cmudict() -> &'static HashMap<String, String> {
    CMUDICT.get_or_init(|| {
        let raw = include_str!("../../assets/cmudict.dict");
        let mut dict = HashMap::with_capacity(140000);
        for line in raw.lines() {
            let parts: Vec<&str> = line.splitn(2, ' ').collect();
            if parts.len() == 2 {
                let word = parts[0].to_lowercase();
                // Convert ARPABET to IPA
                let ipa: String = parts[1]
                    .split_whitespace()
                    .map(arpa_to_ipa)
                    .collect();
                dict.insert(word, ipa);
            }
        }
        dict
    })
}

/// Convert English text to IPA phonemes using CMUDict
fn english_word_to_ipa(word: &str) -> String {
    let dict = load_cmudict();
    let lower = word.to_lowercase();

    if let Some(ipa) = dict.get(&lower) {
        return ipa.clone();
    }

    // Fallback: spell out letter by letter
    lower.chars().map(|c| match c {
        'a' => "ɐ", 'b' => "b", 'c' => "s", 'd' => "d", 'e' => "ɛ",
        'f' => "f", 'g' => "ɡ", 'h' => "h", 'i' => "ɪ", 'j' => "dʒ",
        'k' => "k", 'l' => "l", 'm' => "m", 'n' => "n", 'o' => "ɔ",
        'p' => "p", 'q' => "k", 'r' => "ɹ", 's' => "s", 't' => "t",
        'u' => "ʌ", 'v' => "v", 'w' => "w", 'x' => "ks", 'y' => "j",
        'z' => "z", _ => "",
    }).collect()
}

/// Convert text to IPA phonemes suitable for Kokoro
pub fn text_to_phonemes(text: &str) -> String {
    let mut result = String::new();
    let mut current_word = String::new();

    for c in text.chars() {
        if c.is_alphabetic() || c == '\'' {
            current_word.push(c);
        } else {
            if !current_word.is_empty() {
                if !result.is_empty() && !result.ends_with(' ') {
                    result.push(' ');
                }
                result.push_str(&english_word_to_ipa(&current_word));
                current_word.clear();
            }
            // Keep punctuation that Kokoro understands
            match c {
                '.' | ',' | '!' | '?' | ';' | ':' | '—' | '…' => {
                    result.push(c);
                }
                ' ' | '\n' | '\t' => {
                    if !result.ends_with(' ') {
                        result.push(' ');
                    }
                }
                _ => {} // skip other chars
            }
        }
    }

    // Flush last word
    if !current_word.is_empty() {
        if !result.is_empty() && !result.ends_with(' ') {
            result.push(' ');
        }
        result.push_str(&english_word_to_ipa(&current_word));
    }

    result.trim().to_string()
}
