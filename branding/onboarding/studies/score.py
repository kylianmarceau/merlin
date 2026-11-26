"""Original stereo soundtrack for the Eyrie opening, synthesized at 48 kHz.

Adapted from the Night Watch score: the swell becomes the wingbeats off the
ledge and the three mallet notes land as the falcon becomes the mark.
"""

import wave

import numpy as np


RATE = 48000


def smoothstep(value):
    value = np.clip(value, 0, 1)
    return value * value * (3 - 2 * value)


def note_phase(time, note, cents=0):
    hz = 440 * 2 ** ((note - 69 + cents / 100) / 12)
    return 2 * np.pi * hz * time


def mallet(time, note):
    """Give the strike a woody attack and a softer pitched tail."""
    phase = note_phase(time, note)
    body = np.sin(phase) * np.exp(-time / 0.55)
    overtones = (
        0.32 * np.sin(2 * phase + 0.3) * np.exp(-time / 0.19)
        + 0.19 * np.sin(3.98 * phase) * np.exp(-time / 0.065)
        + 0.08 * np.sin(8.12 * phase) * np.exp(-time / 0.022)
    )
    return (body + overtones) * smoothstep(time / 0.021)


def write_score(path, duration):
    time = np.arange(round(duration * RATE)) / RATE
    mix = np.zeros((len(time), 2))

    # Open with one low, soft impact. The octave keeps it audible on laptops.
    elapsed = np.maximum(time - 0.13, 0)
    phase = 2 * np.pi * (72 * elapsed + 5.5 * (1 - np.exp(-elapsed / 0.049)))
    impact = (np.sin(phase) + 0.62 * np.sin(2 * phase) + 0.17 * np.sin(3 * phase))
    impact *= smoothstep(elapsed / 0.041) * np.exp(-elapsed / 0.24)
    mix += 0.16 * impact[:, None]

    # A close-spaced pickup and a higher third note form the audible mark.
    # The first note marks the moon crossing; the pickup and the high third
    # land as the falcon settles into the mark.
    for start, note, pan, gain in [
        (2.90, 64, -0.30, 0.080),
        (3.92, 66, -0.22, 0.115),
        (4.12, 69, 0.18, 0.106),
        (4.40, 76, 0.03, 0.150),
    ]:
        offset = round(start * RATE)
        tone = mallet(time[offset:] - offset / RATE, note)
        mix[offset:] += gain * tone[:, None] * np.sqrt([(1 - pan) / 2, (1 + pan) / 2])

    # Move from a dark B minor voicing to D major under the last note. Leave
    # the two low fundamentals centered and let the upper voices spread.
    for note, start, attack, hold, decay, gain in [
        (35, 0.45, 0.70, 1.60, 0.44, 0.039),
        (54, 0.73, 0.91, 1.64, 0.68, 0.032),
        (62, 1.14, 0.69, 3.60, 0.60, 0.023),
        (38, 4.24, 0.39, 5.45, 0.95, 0.061),
        (57, 4.35, 0.43, 5.40, 0.95, 0.043),
        (66, 4.44, 0.52, 5.35, 0.90, 0.037),
        (73, 4.57, 0.68, 5.40, 0.90, 0.016),
    ]:
        envelope = (
            smoothstep((time - start) / attack)
            * np.exp(-np.maximum(time - hold, 0) / decay)
        )
        spread = 0 if note < 45 else 3.5
        for channel, detune in enumerate((-spread, spread)):
            phase = note_phase(time, note, detune)
            phase += 0.24 * np.sin(2 * np.pi * 0.39 * time)
            mix[:, channel] += gain * envelope * (
                np.sin(phase) + 0.34 * np.sin(2 * phase) + 0.11 * np.sin(3 * phase)
            )

    # A soft left-to-right swell leads into the pickup. A much quieter wash
    # carries the transition into the daylight painting.
    rng = np.random.default_rng(8241)
    frequencies = np.fft.rfftfreq(len(time), 1 / RATE)
    band = (1 - np.exp(-(frequencies / 390) ** 2)) / (1 + (frequencies / 2170) ** 4)
    rise = smoothstep((time - 0.62) / 1.0)
    # Wingbeats off the ledge: the swell pulses with the flaps, then falls away.
    beats = 1 + 0.6 * np.maximum(0, np.sin(2 * np.pi * 4.2 * (time - 1.62))) * (time > 1.62) * (time < 2.75)
    swell = rise * beats * np.exp(-np.maximum(time - 2.2, 0) / 0.32)
    dawn = np.exp(-0.5 * ((time - 6.0) / 0.5) ** 2)
    for channel in range(2):
        spectrum = np.fft.rfft(rng.normal(size=len(time)))
        air = np.fft.irfft(spectrum * band, n=len(time))
        sweep = (0.92 - 0.60 * rise) if channel == 0 else (0.32 + 0.60 * rise)
        mix[:, channel] += air / np.std(air) * (0.023 * sweep * swell + 0.003 * dawn)

    dry = mix.copy()
    for delay, gain in [(0.041, 0.14), (0.077, 0.10), (0.127, 0.083), (0.201, 0.064), (0.32, 0.038)]:
        offset = round(delay * RATE)
        mix[offset:] += gain * dry[:-offset, ::-1]

    # Let the tail reach silence before the appearance controls take over.
    mix *= (smoothstep((duration - time - 0.08) / 0.94) * 1.32)[:, None]
    with wave.open(str(path), "wb") as out:
        out.setparams((2, 2, RATE, 0, "NONE", "not compressed"))
        out.writeframes(np.rint(np.clip(mix, -1, 1) * 32767).astype("<i2").tobytes())
