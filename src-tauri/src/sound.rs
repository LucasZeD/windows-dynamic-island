//! Short alert sounds: Windows' own (the calendar chime) and audio files (the
//! Claude Code alerts, MP3 / WAV / WMA through MCI), plus a picker for them.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use tauri::{AppHandle, Manager};

/// One of Windows' sounds by alias (`HKCU\AppEvents\EventLabels`), e.g.
/// "Notification.Reminder"; nothing when the user turned it off.
pub fn system(alias: &str) {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::Media::Audio::{PlaySoundW, SND_ALIAS, SND_ASYNC, SND_NODEFAULT};
        let alias = windows::core::HSTRING::from(alias);
        let _ = PlaySoundW(&alias, None, SND_ALIAS | SND_ASYNC | SND_NODEFAULT);
    }
    #[cfg(not(windows))]
    let _ = alias;
}

/// Plays an audio file in the background at the app's volume (`sound.volume`);
/// overlapping calls play together.
pub fn file(app: &AppHandle, path: &Path) {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    let volume = volume(app);
    let alias = format!("island-sound-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let path = path.to_string_lossy().replace('"', "");
    std::thread::spawn(move || {
        // `wait` blocks this thread until the end, so the device can be closed.
        if mci(&format!("open \"{path}\" type mpegvideo alias {alias}")) {
            mci(&format!("setaudio {alias} volume to {volume}"));
            mci(&format!("play {alias} wait"));
            mci(&format!("close {alias}"));
        } else {
            log::warn!("sound: can't play {path}");
        }
    });
}

#[cfg(windows)]
fn mci(command: &str) -> bool {
    use windows::Win32::Media::Multimedia::mciSendStringW;
    let command = windows::core::HSTRING::from(command);
    unsafe { mciSendStringW(&command, None, None) == 0 }
}

#[cfg(not(windows))]
fn mci(_command: &str) -> bool {
    false
}

/// A sound shipped with the app, written next to its data on first use (MCI
/// plays files, not memory).
pub fn bundled(app: &AppHandle, name: &str, bytes: &[u8]) -> Option<PathBuf> {
    let path = app.path().app_data_dir().ok()?.join("sounds").join(name);
    if std::fs::metadata(&path).is_ok_and(|m| m.len() == bytes.len() as u64) {
        return Some(path);
    }
    std::fs::create_dir_all(path.parent()?).ok()?;
    std::fs::write(&path, bytes).ok()?;
    Some(path)
}

/// Windows' "Open" dialog for an audio file; `None` when cancelled. Blocks
/// until the user picks.
pub fn pick() -> Option<String> {
    crate::dialog::pick_file("Audio (MP3, WAV, WMA)", "*.mp3;*.wav;*.wma")
}

/// Sample rate of the synthesized tones.
const RATE: u32 = 44_100;

/// One note of a tone.
struct Note {
    /// When it starts (s).
    at: f64,
    /// Pitch (Hz).
    freq: f64,
    /// How fast it fades (1/s).
    decay: f64,
    level: f64,
    /// Overtones: (multiple of `freq`, loudness).
    partials: &'static [(f64, f64)],
    /// Rises by this fraction of its pitch over its first 60 ms (a drop's "pop").
    glide: f64,
}

/// A small bell: the note, its octave, a touch of the 12th.
const BELL: &[(f64, f64)] = &[(1.0, 1.0), (2.0, 0.28), (3.0, 0.08)];
/// Glassy and bright: the octave and the double octave.
const GLASS: &[(f64, f64)] = &[(1.0, 1.0), (2.0, 0.4), (4.0, 0.12)];
/// A wooden bar: a marimba's strong partial near the double octave.
const WOOD: &[(f64, f64)] = &[(1.0, 1.0), (3.93, 0.3), (9.2, 0.05)];
/// Odd harmonics, a square wave rounded off: an old console's beep.
const RETRO: &[(f64, f64)] = &[(1.0, 1.0), (3.0, 0.3), (5.0, 0.15), (7.0, 0.07)];
const PURE: &[(f64, f64)] = &[(1.0, 1.0)];

const fn note(at: f64, freq: f64, decay: f64, level: f64, partials: &'static [(f64, f64)]) -> Note {
    Note {
        at,
        freq,
        decay,
        level,
        partials,
        glide: 0.0,
    }
}

/// The tones to pick from for a finished task (`sound.toastTone`); the first is the default.
pub const TONES: [&str; 5] = ["chime", "sparkle", "marimba", "pop", "arcade"];

/// A tone's notes and length (s).
fn tone(id: &str) -> (Vec<Note>, f64) {
    match id {
        // Four glassy notes up the chord (C6, E6, G6, C7), the last one ringing.
        "sparkle" => (
            vec![
                note(0.0, 1046.50, 11.0, 0.6, GLASS),
                note(0.045, 1318.51, 11.0, 0.65, GLASS),
                note(0.09, 1567.98, 10.0, 0.7, GLASS),
                note(0.135, 2093.00, 5.0, 0.8, GLASS),
            ],
            0.9,
        ),
        // Two wooden notes a fourth apart (G5, C6).
        "marimba" => (
            vec![
                note(0.0, 783.99, 13.0, 0.9, WOOD),
                note(0.11, 1046.50, 9.0, 1.0, WOOD),
            ],
            0.7,
        ),
        // A drop of water: two quick upward sweeps.
        "pop" => (
            vec![
                Note {
                    glide: 0.9,
                    ..note(0.0, 520.0, 26.0, 1.0, PURE)
                },
                Note {
                    glide: 0.6,
                    ..note(0.09, 880.0, 30.0, 0.55, PURE)
                },
            ],
            0.35,
        ),
        // Two quick beeps up a fourth (A5, D6), the second held a bit.
        "arcade" => (
            vec![
                note(0.0, 880.0, 18.0, 1.0, RETRO),
                note(0.085, 1174.66, 6.0, 1.0, RETRO),
            ],
            0.6,
        ),
        // The chime: three bells rising (C6, E6, G6), each ringing out.
        _ => (
            vec![
                note(0.0, 1046.50, 7.0, 0.8, BELL),
                note(0.075, 1318.51, 6.5, 0.85, BELL),
                note(0.15, 1567.98, 4.2, 1.0, BELL),
            ],
            0.95,
        ),
    }
}

/// Headroom: notes ringing together stay well under full scale.
const GAIN: f64 = 0.2;

/// A tone as a 16-bit mono WAV. Made here: no sound files to ship or license.
pub fn tone_wav(id: &str) -> Vec<u8> {
    use std::f64::consts::TAU;
    let (notes, seconds) = tone(id);
    let samples = (RATE as f64 * seconds) as usize;
    let fade_out = (RATE as f64 * 0.03) as usize;
    let dt = 1.0 / RATE as f64;
    // Each note's phase, accumulated so a gliding pitch stays smooth.
    let mut phase = vec![0.0f64; notes.len()];
    let pcm: Vec<i16> = (0..samples)
        .map(|i| {
            let t = i as f64 * dt;
            let mut v = 0.0;
            for (n, p) in notes.iter().zip(phase.iter_mut()) {
                let local = t - n.at;
                if local < 0.0 {
                    continue;
                }
                let freq = n.freq * (1.0 + n.glide * (local / 0.06).min(1.0));
                *p += TAU * freq * dt;
                // A 4 ms attack (no click), then an exponential fade.
                let envelope = (local / 0.004).min(1.0) * (-local * n.decay).exp();
                let tone: f64 = n.partials.iter().map(|(k, a)| a * (k * *p).sin()).sum();
                v += n.level * envelope * tone;
            }
            // The tail fades to silence instead of stopping.
            let tail = ((samples - i) as f64 / fade_out as f64).min(1.0);
            (v * GAIN * tail * i16::MAX as f64).round() as i16
        })
        .collect();
    wav(&pcm, RATE)
}

/// 16-bit mono PCM in a WAV container.
fn wav(pcm: &[i16], rate: u32) -> Vec<u8> {
    let data = (pcm.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // fmt chunk size
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2).to_le_bytes()); // bytes per second
    out.extend_from_slice(&2u16.to_le_bytes()); // block align
    out.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data.to_le_bytes());
    for s in pcm {
        out.extend_from_slice(&s.to_le_bytes());
    }
    out
}

/// The app's sound volume, 0–100 (Settings → Sound).
const VOLUME_KEY: &str = "sound.volume";
const DEFAULT_VOLUME: u64 = 70;
/// The finished-task tone (Settings → Sound).
const TONE_KEY: &str = "sound.toastTone";

/// The volume setting on MCI's 0–1000 scale.
fn volume(app: &AppHandle) -> u32 {
    let percent = app
        .state::<crate::settings::Settings>()
        .get(VOLUME_KEY)
        .and_then(|v| v.as_u64())
        .unwrap_or(DEFAULT_VOLUME)
        .min(100);
    percent as u32 * 10
}

/// A toast said something finished: plays `tone`, else the chosen one.
/// Whether to play at all is the frontend's call (`sound.toast`).
#[tauri::command]
pub fn play_toast_sound(app: AppHandle, tone: Option<String>) {
    let chosen = tone.or_else(|| {
        app.state::<crate::settings::Settings>()
            .get(TONE_KEY)
            .and_then(|v| v.as_str().map(str::to_owned))
    });
    let id = chosen
        .as_deref()
        .filter(|t| TONES.contains(t))
        .unwrap_or(TONES[0]);
    if let Some(path) = bundled(&app, &format!("toast-{id}.wav"), &tone_wav(id)) {
        file(&app, &path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pcm(wav: &[u8]) -> Vec<i16> {
        wav[44..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|b| i16::from_le_bytes(*b))
            .collect()
    }

    #[test]
    fn every_tone_is_a_valid_short_wav() {
        for id in TONES {
            let wav = tone_wav(id);
            assert_eq!(&wav[0..4], b"RIFF", "{id}");
            assert_eq!(&wav[8..16], b"WAVEfmt ", "{id}");
            assert_eq!(
                u32::from_le_bytes(wav[4..8].try_into().unwrap()) as usize,
                wav.len() - 8
            );
            let seconds = (wav.len() - 44) as f64 / 2.0 / RATE as f64;
            assert!((0.2..=1.0).contains(&seconds), "{id}: {seconds} s");
        }
    }

    #[test]
    fn no_tone_clips_or_whispers_and_all_end_in_silence() {
        for id in TONES {
            let pcm = pcm(&tone_wav(id));
            let peak = pcm.iter().map(|s| s.unsigned_abs()).max().unwrap();
            assert!(
                u32::from(peak) < i16::MAX as u32 * 9 / 10,
                "{id}: peak {peak}"
            );
            assert!(peak > (i16::MAX as u16) / 6, "{id}: too quiet ({peak})");
            assert!(pcm.last().unwrap().unsigned_abs() < 50, "{id}");
        }
    }

    #[test]
    fn unknown_tones_fall_back_to_the_chime() {
        assert_eq!(tone_wav("nope"), tone_wav("chime"));
    }
}
