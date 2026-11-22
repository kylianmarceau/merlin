"""Original stereo cue for the first-light film. All sounds are synthesized."""
import wave

import numpy as np


RATE = 48000


def write_score(path, duration, sunrise, flight, title):
    rng = np.random.default_rng(8241)
    time = np.arange(round(duration * RATE)) / RATE
    mix = np.zeros((len(time), 2))
    frequencies = np.fft.rfftfreq(len(time), 1 / RATE)
    breeze = np.sin(np.pi * time / duration) ** 1.4

    # Air in the grasses. Keep the low rumble out and let the breeze move
    # differently on either side of the listener.
    spectrum = (1 - np.exp(-(frequencies / 125) ** 2)) / (1 + (frequencies / 950) ** 3)
    for channel in range(2):
        noise = np.fft.rfft(rng.normal(size=len(time)))
        air = np.fft.irfft(noise * spectrum, n=len(time))
        mix[:, channel] = air / np.std(air) * (.004 + .006 * breeze)

    def place(sound, start, pan):
        offset = int(start * RATE)
        count = min(len(sound), len(time) - offset)
        if count > 0:
            gains = np.sqrt([(1 - pan) / 2, (1 + pan) / 2])
            mix[offset:offset + count] += sound[:count, None] * gains

    # Felt strikes: the hammer and upper partials die away before the body
    # of each note. Two slightly detuned strings supply the slow beating.
    for start, pitch, strength, pan in [
        (sunrise, 55, .12, -.20), (sunrise + .54, 62, .118, -.08),
        (flight + .78, 69, .09, .23), (title, 66, .14, .06),
        (title + .48, 74, .075, .31), (title + 1.52, 62, .058, -.14),
    ]:
        hz = 440 * 2 ** ((pitch - 69) / 12)
        t = np.arange(round(min(3.6, duration - start) * RATE)) / RATE
        strike = np.zeros_like(t)
        for partial, gain, decay in [(1, 1, 1.28), (2, .40, .74), (3, .14, .41), (5, .06, .19)]:
            phase = 2 * np.pi * hz * partial * t
            strings = .64 * np.sin(phase) + .36 * np.sin(phase * 1.0014)
            strike += gain * strings * np.exp(-t / decay)
        place(strength * strike * (1 - np.exp(-t / .016)), start, pan)

    # A low bowed fifth opens with the light and recedes under the last note.
    pad = np.zeros_like(time)
    for hz, gain in [(146.83, .021), (220, .012), (293.66, .006)]:
        pad += gain * np.sin(2 * np.pi * hz * time + .23 * np.sin(2 * np.pi * .74 * time))
    place(pad * breeze ** 2, 0, -.08)

    # Short, diffuse reflections. Use the dry signal for each reflection so
    # the release sounds like one space and doesn't build a feedback tail.
    dry = mix.copy()
    for delay, gain in [(.043, .12), (.071, .09), (.111, .065), (.168, .045), (.254, .028)]:
        offset = round(delay * RATE)
        mix[offset:] += dry[:-offset, ::-1] * gain
    attack = np.clip(time / .3, 0, 1)
    release = np.clip((duration - time) / .84, 0, 1)
    mix *= (attack * (release ** 2 * (3 - 2 * release)))[:, None]
    mix *= 1.5  # Master the cue around -22 LUFS, with room above the soft strikes.
    with wave.open(str(path), 'wb') as wav:
        wav.setparams((2, 2, RATE, 0, 'NONE', 'not compressed'))
        wav.writeframes(np.rint(np.clip(mix, -1, 1) * 32767).astype('<i2').tobytes())
