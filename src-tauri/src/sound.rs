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

/// Plays an audio file in the background; overlapping calls play together.
pub fn file(path: &Path) {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    let alias = format!("island-sound-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let path = path.to_string_lossy().replace('"', "");
    std::thread::spawn(move || {
        // `wait` blocks this thread until the end, so the device can be closed.
        if mci(&format!("open \"{path}\" type mpegvideo alias {alias}")) {
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

/// Sample rate of the synthesized chime.
const CHIME_RATE: u32 = 44_100;
/// Length of the chime (s): the notes plus their ring.
const CHIME_SECONDS: f64 = 0.95;
/// The notes, rising (C6, E6, G6): when each starts (s), its pitch (Hz), how
/// fast it fades (1/s) and how loud it is.
const CHIME_NOTES: [(f64, f64, f64, f64); 3] = [
    (0.0, 1046.50, 7.0, 0.8),
    (0.075, 1318.51, 6.5, 0.85),
    (0.15, 1567.98, 4.2, 1.0),
];
/// Headroom: the three notes together stay well under full scale.
const CHIME_GAIN: f64 = 0.2;

/// A short rewarding chime for a finished task: three bell-like notes rising,
/// each ringing out. Made here (no sound file to ship or license), as a 16-bit
/// mono WAV.
pub fn chime_wav() -> Vec<u8> {
    use std::f64::consts::TAU;
    let samples = (CHIME_RATE as f64 * CHIME_SECONDS) as usize;
    let fade_out = (CHIME_RATE as f64 * 0.03) as usize;
    let pcm: Vec<i16> = (0..samples)
        .map(|i| {
            let t = i as f64 / CHIME_RATE as f64;
            let mut v = 0.0;
            for (start, freq, decay, level) in CHIME_NOTES {
                let local = t - start;
                if local < 0.0 {
                    continue;
                }
                // A 4 ms attack (no click), then a bell's exponential fade.
                let envelope = (local / 0.004).min(1.0) * (-local * decay).exp();
                // The partials of a small bell: the note, its octave, a touch of the 12th.
                let tone = (TAU * freq * local).sin()
                    + 0.28 * (TAU * 2.0 * freq * local).sin()
                    + 0.08 * (TAU * 3.0 * freq * local).sin();
                v += level * envelope * tone;
            }
            // The tail fades to silence instead of stopping.
            let tail = ((samples - i) as f64 / fade_out as f64).min(1.0);
            (v * CHIME_GAIN * tail * i16::MAX as f64).round() as i16
        })
        .collect();
    wav(&pcm, CHIME_RATE)
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

/// The island's toast said something finished (`appearance.toastSound`, checked by the frontend).
#[tauri::command]
pub fn play_toast_sound(app: AppHandle) {
    static CHIME: std::sync::OnceLock<Vec<u8>> = std::sync::OnceLock::new();
    let bytes = CHIME.get_or_init(chime_wav);
    if let Some(path) = bundled(&app, "toast-chime.wav", bytes) {
        file(&path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_chime_is_a_valid_short_wav() {
        let wav = chime_wav();
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..16], b"WAVEfmt ");
        let samples = (wav.len() - 44) / 2;
        assert_eq!(samples, (CHIME_RATE as f64 * CHIME_SECONDS) as usize);
        assert_eq!(u32::from_le_bytes(wav[4..8].try_into().unwrap()) as usize, wav.len() - 8);
    }

    #[test]
    fn the_chime_never_clips_and_ends_in_silence() {
        let wav = chime_wav();
        let pcm: Vec<i16> = wav[44..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|b| i16::from_le_bytes(*b))
            .collect();
        let peak = pcm.iter().map(|s| s.unsigned_abs()).max().unwrap();
        assert!(u32::from(peak) < i16::MAX as u32 * 9 / 10, "peak {peak}");
        assert!(peak > (i16::MAX as u16) / 5, "too quiet: {peak}");
        assert!(pcm.last().unwrap().unsigned_abs() < 50);
    }
}
