"""Original score and sound design for the Eyrie film (second cut), 48 kHz stereo.

Music: a felt piano and warm pads move from B minor through G and E minor to
a suspended A, and resolve to D major as the falcon becomes the mark. Dawn
lifts it with high voices.

Sound: mountain wind throughout, snow kicked off the ledge, a whoosh on every
downstroke panned to where the bird is and as loud as it is close, a meteor,
a bell as the bird crosses the moon, a reversed swell into the mark and a
glassy tick under each rising letter. Everything shares one synthetic hall.

    python score3.py out/score3.wav
"""
import sys
import wave

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

R = 48000
DUR = 7.6
N = int(DUR * R)
T = np.arange(N) / R
rng = np.random.default_rng(20261125)

# Timings shared with film2.py.
LAUNCH, GLIDE_IN, GLIDE_OUT, MARK_IN, SETTLE, TITLE, DAWN = 1.58, 2.62, 3.02, 3.98, 4.32, 4.20, 5.65


def hz(note):
    return 440.0 * 2 ** ((note - 69) / 12)


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def band(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], btype='band', fs=R, output='sos'), x)


def lowpass(x, f, order=2):
    return sosfilt(butter(order, f, btype='low', fs=R, output='sos'), x)


def highpass(x, f, order=2):
    return sosfilt(butter(order, f, btype='high', fs=R, output='sos'), x)


def pan_gains(p):
    """Equal-power pan, p in [-1, 1]."""
    a = (np.asarray(p) + 1) * np.pi / 4
    return np.cos(a), np.sin(a)


class Bus:
    def __init__(self):
        self.dry = np.zeros((N, 2))
        self.send = np.zeros((N, 2))

    def add(self, sig, t0, gain=1.0, pan=0.0, send=0.3):
        i0 = int(round(t0 * R))
        if i0 >= N:
            return
        if sig.ndim == 1:
            gl, gr = pan_gains(pan)
            sig = np.stack([sig * gl, sig * gr], 1)
        j0 = max(0, -i0)
        i0c = max(0, i0)
        n = min(len(sig) - j0, N - i0c)
        if n <= 0:
            return
        self.dry[i0c:i0c + n] += sig[j0:j0 + n] * gain
        self.send[i0c:i0c + n] += sig[j0:j0 + n] * gain * send


# ---------------------------------------------------------------- instruments

def piano(note, vel=0.6, length=4.5):
    """A felt piano: soft hammer, slightly stretched partials, two strings per note."""
    f = hz(note)
    n = int(length * R)
    t = np.arange(n) / R
    out = np.zeros(n)
    B = 0.00035
    for k in range(1, 13):
        fk = k * f * np.sqrt(1 + B * k * k)
        if fk > 12000:
            break
        amp = k ** -1.35 * np.exp(-(k - 1) * (0.62 - 0.3 * vel))
        tau = np.clip(3.4 / (1 + 0.5 * (k - 1)) * (220 / f) ** 0.4, 0.12, 7.0)
        env = 0.6 * np.exp(-t / (tau * 0.35)) + 0.4 * np.exp(-t / (tau * 1.6))
        ph = rng.uniform(0, 2 * np.pi)
        strings = np.sin(2 * np.pi * fk * 0.99935 * t + ph) + np.sin(2 * np.pi * fk * 1.00065 * t + ph * 1.3)
        out += amp * env * strings * 0.5
    out *= 1 - np.exp(-t / 0.0045)
    hammer = lowpass(rng.normal(size=n) * np.exp(-t / 0.007), 1400) * 0.25
    out += hammer
    # Felt: roll the top off, more for softer notes.
    out = lowpass(out, 2200 + 4000 * vel)
    out *= 1 - smooth((t - (length - 0.4)) / 0.4)
    return out * vel / 1.6


def celesta(note, vel=0.6, length=3.5):
    f = hz(note)
    n = int(length * R)
    t = np.arange(n) / R
    out = np.zeros(n)
    for ratio, amp, tau in [(1, 1, 2.2), (2.005, 0.30, 0.8), (3.01, 0.12, 0.35), (4.97, 0.06, 0.16), (7.1, 0.03, 0.06)]:
        vib = 0.0012 / (2 * np.pi * 5.2) * np.sin(2 * np.pi * 5.2 * t) * (1 - np.exp(-t / 0.4))
        out += amp * np.exp(-t / tau) * np.sin(2 * np.pi * f * ratio * (t + vib) + rng.uniform(0, 6.28))
    out *= 1 - np.exp(-t / 0.0025)
    out *= 1 - smooth((t - (length - 0.3)) / 0.3)
    return out * vel * 0.6


def pad(notes, t0, t1, attack=0.8, release=1.2, bright=None, gain=1.0):
    """Warm detuned voices; bright(t) in [0, 1] opens the tone over time."""
    i0 = int(max(0, t0 - 0.01) * R)
    i1 = min(N, int((t1 + release * 3) * R))
    t = T[i0:i1]
    env = smooth((t - t0) / attack) * np.where(t > t1, np.exp(-(t - t1) / release), 1.0)
    b = bright(t) if bright is not None else np.full_like(t, 0.3)
    expo = 2.7 - 1.5 * b
    out = np.zeros((len(t), 2))
    for note in notes:
        f = hz(note)
        kmax = int(min(14, 7000 / f))
        for ch in (0, 1):
            for det in ((-7, 4) if ch == 0 else (-4, 7)):
                fd = f * 2 ** (det / 1200)
                rate = rng.uniform(0.1, 0.25)
                # Slow drift of about a cent, integrated so it never accumulates.
                drift = 0.0006 / (2 * np.pi * rate) * np.sin(2 * np.pi * rate * t + rng.uniform(0, 6))
                ph0 = rng.uniform(0, 2 * np.pi, kmax)
                for k in range(1, kmax + 1):
                    out[:, ch] += np.exp(-expo * np.log(k)) * np.sin(2 * np.pi * fd * k * (t + drift) + ph0[k - 1])
    out *= env[:, None] * gain / (len(notes) * 2.2)
    sig = np.zeros((N, 2))
    sig[i0:i1] = out
    return sig


def noise_burst(length, lo, hi, attack, decay, seed=None):
    r = np.random.default_rng(seed)
    n = int(length * R)
    t = np.arange(n) / R
    x = band(r.normal(size=n), lo, hi)
    env = smooth(t / attack) * np.exp(-np.maximum(t - attack, 0) / decay)
    return x * env / (np.std(x) + 1e-9)


def whoosh(length, gain, seed):
    """Air moved by a wing: a band of noise sweeping down as the stroke ends."""
    n = int(length * R)
    t = np.arange(n) / R
    r = np.random.default_rng(seed)
    x = r.normal(size=n)
    hi = band(x, 900, 3200)
    lo = band(x, 160, 700)
    u = t / length
    env = smooth(u / 0.35) * (1 - smooth((u - 0.35) / 0.65)) ** 1.5
    sig = (hi * (1 - u) * 0.5 + lo * (0.6 + 0.6 * u)) * env
    return sig / (np.std(sig) + 1e-9) * gain


# ---------------------------------------------------------------- the flight, as heard

KEYS = [(1.58, 1240, 230), (1.84, 1120, 200), (2.12, 990, 160), (2.48, 820, 104), (2.86, 668, 72),
        (3.18, 548, 64), (3.48, 500, 70), (3.78, 580, 80), (4.06, 712, 95), (4.32, 800, 95)]


def bird_at(t):
    ts = [k[0] for k in KEYS]
    x = np.interp(t, ts, [k[1] for k in KEYS])
    s = np.interp(t, ts, [k[2] for k in KEYS])
    return (x - 800) / 800, s


def downstrokes():
    """Times of each downstroke, from the same beat schedule as the film."""
    out = []
    dt = 1 / 2000
    phase = 0.78
    t = LAUNCH
    last = int(np.floor(phase))
    while t < MARK_IN + 0.25:
        f = 3.9 if t < GLIDE_IN else (0.0 if t < GLIDE_OUT else 3.7)
        phase += f * dt
        t += dt
        if int(np.floor(phase)) != last:
            last = int(np.floor(phase))
            out.append(t)
    return out


# ---------------------------------------------------------------- the hall

def hall(length=3.4, seed=7):
    n = int(length * R)
    t = np.arange(n) / R
    r = np.random.default_rng(seed)
    ir = np.zeros((n, 2))
    for ch in range(2):
        x = r.normal(size=n)
        for lo, hi, decay in [(60, 300, 2.4), (300, 1500, 2.0), (1500, 5000, 1.3), (5000, 14000, 0.6)]:
            ir[:, ch] += band(x, lo, hi) * np.exp(-t * 6.9 / decay)
        # A soft onset so the tail blooms rather than slaps.
        ir[:, ch] *= smooth(t / 0.035)
    pre = int(0.022 * R)
    ir = np.concatenate([np.zeros((pre, 2)), ir])
    for d, g in [(0.011, 0.5), (0.019, 0.35), (0.029, 0.3), (0.041, 0.22)]:
        ir[int(d * R), 0] += g
        ir[int((d * 1.13) * R), 1] += g
    return ir / np.sqrt(np.sum(ir ** 2) / 2)


def render():
    music, fx, air = Bus(), Bus(), Bus()

    # ---- wind: two layers that breathe and wander between the ears
    x = rng.normal(size=(N, 2))
    gust = 0.55 + 0.25 * np.sin(2 * np.pi * 0.17 * T + 1) + 0.2 * np.sin(2 * np.pi * 0.41 * T + 2.3)
    low = np.stack([band(x[:, c], 90, 420) for c in range(2)], 1)
    hiss = np.stack([band(x[:, c], 900, 2600) for c in range(2)], 1)
    whistle = np.stack([band(x[:, c], 1500, 1800, order=3) for c in range(2)], 1)
    swirl = 0.5 + 0.5 * np.sin(2 * np.pi * 0.23 * T)[:, None] * np.float64([1, -1])
    wind = low / low.std() * 0.55 + hiss / hiss.std() * 0.22 * swirl + whistle / whistle.std() * 0.08 * gust[:, None]
    wind_env = smooth(T / 0.9) * (1 - 0.45 * smooth((T - SETTLE) / 1.0)) * (1 - 0.5 * smooth((T - DAWN) / 1.5))
    air.add(wind * (gust * wind_env)[:, None], 0, gain=0.15, send=0.05)

    # ---- night: B minor, a lullaby on the piano
    bright_night = lambda t: 0.15 + 0.1 * smooth((t - 0.5) / 1.0)
    music.add(pad([47, 54, 62, 73], 0.0, 1.75, attack=1.1, release=0.7, bright=bright_night), 0, gain=0.55, send=0.35)
    music.add(pad([35], 0.0, 1.75, attack=1.4, release=0.8, bright=lambda t: 0.0 * t), 0, gain=0.22, send=0.1)
    for t0, note, vel, p in [(0.22, 71, 0.42, -0.1), (0.52, 78, 0.38, 0.1), (0.84, 74, 0.40, 0.0),
                             (1.20, 73, 0.34, -0.05)]:
        music.add(piano(note, vel), t0, pan=p, send=0.4)
    # Meteor: a high, falling shimmer, panned with it from right to centre.
    m = noise_burst(0.7, 3500, 9000, 0.25, 0.25, seed=3)
    tt = np.arange(len(m)) / R
    m = m * (0.6 + 0.4 * np.sin(2 * np.pi * (2200 - 900 * tt) * tt))
    fx.add(m, 0.55, gain=0.05, pan=0.45, send=0.6)

    # ---- launch: snow off the ledge and the first heavy stroke
    crunch = np.zeros(int(0.5 * R))
    for _ in range(70):
        i = int(abs(rng.normal(0, 0.06)) * R)
        g = rng.uniform(0.2, 1.0)
        n = int(rng.uniform(0.002, 0.007) * R)
        if i + n < len(crunch):
            crunch[i:i + n] += rng.normal(size=n) * np.exp(-np.arange(n) / (n / 3)) * (1 - np.exp(-np.arange(n) / 24)) * g
    crunch = highpass(crunch, 1800)
    fx.add(crunch / (4 * np.std(crunch[: int(0.15 * R)])), LAUNCH - 0.02, gain=0.07, pan=0.55, send=0.2)
    thump = np.sin(2 * np.pi * 62 * np.arange(int(0.4 * R)) / R) * np.exp(-np.arange(int(0.4 * R)) / R / 0.09)
    fx.add(thump, LAUNCH, gain=0.12, pan=0.4, send=0.05)

    # ---- flight: G major opening up, a rising line on the wingbeats
    bright_flight = lambda t: 0.3 + 0.45 * smooth((t - LAUNCH) / 1.0)
    music.add(pad([43, 50, 59, 66], LAUNCH - 0.05, 2.80, attack=0.5, release=0.5, bright=bright_flight), 0, gain=0.6, send=0.35)
    music.add(pad([43 - 12], LAUNCH - 0.05, 2.80, attack=0.6, release=0.6, bright=lambda t: 0.0 * t), 0, gain=0.2, send=0.1)
    strokes = downstrokes()
    line = [67, 71, 74, 78]
    for i, ts in enumerate(strokes):
        p, s = bird_at(ts)
        g = (s / 230) ** 0.9
        fx.add(whoosh(0.24, 1.0, seed=100 + i), ts - 0.02, gain=0.17 * g, pan=float(np.clip(p * 0.9, -0.9, 0.9)),
               send=0.18)
        if i < len(line):
            music.add(piano(line[i], 0.36 + 0.04 * i), ts, pan=float(p * 0.4), send=0.45)

    # ---- across the moon: hush, and a bell
    music.add(pad([40, 47, 55, 66, 74], 2.62, 3.55, attack=0.6, release=0.5,
                  bright=lambda t: 0.55 - 0.2 * smooth((t - 2.6) / 0.5)), 0, gain=0.55, send=0.45)
    music.add(celesta(81, 0.55), 2.80, pan=-0.15, send=0.7)
    music.add(celesta(88, 0.25), 2.86, pan=-0.1, send=0.8)
    music.add(piano(76, 0.32), 3.24, pan=-0.3, send=0.45)

    # ---- the climb: suspended A, rising towards the mark
    music.add(pad([45, 52, 62, 64, 69], 3.40, 4.40, attack=0.7, release=0.3,
                  bright=lambda t: 0.4 + 0.4 * smooth((t - 3.4) / 0.9)), 0, gain=0.55, send=0.4)
    music.add(piano(73, 0.34), 3.62, pan=-0.35, send=0.45)
    riser = noise_burst(1.0, 2500, 9000, 0.95, 0.03, seed=11)
    fx.add(riser * np.linspace(0.2, 1, len(riser)) ** 2, SETTLE - 0.98, gain=0.035, pan=0.0, send=0.5)

    # ---- the mark: resolve to D major, with a reversed bloom into it
    sting = np.zeros(int(3.5 * R))
    for note, vel in [(50, 0.5), (57, 0.45), (66, 0.42), (69, 0.4), (76, 0.38)]:
        sting += piano(note, vel, 3.5)
    sting += celesta(86, 0.4, 3.5) * 0.6
    ir = hall()
    tail = fftconvolve(sting, ir[:, 0])[: int(1.1 * R)]
    tail = np.stack([tail, fftconvolve(sting, ir[:, 1])[: int(1.1 * R)]], 1)
    rev = tail[::-1] * smooth(np.linspace(0, 1, len(tail)))[:, None] ** 1.4
    music.add(rev / np.abs(rev).max(), SETTLE - len(rev) / R, gain=0.11, send=0.1)
    music.add(sting, SETTLE, gain=0.95, send=0.4)
    sub = np.sin(2 * np.pi * hz(38) * np.arange(int(2.5 * R)) / R) * np.exp(-np.arange(int(2.5 * R)) / R / 0.9)
    music.add(sub * smooth(np.arange(len(sub)) / R / 0.03), SETTLE, gain=0.07, send=0.05)
    music.add(pad([38, 45, 54, 62, 64, 69], SETTLE - 0.02, 6.2, attack=0.35, release=1.0,
                  bright=lambda t: 0.45 + 0.35 * smooth((t - DAWN) / 1.2)), 0, gain=0.62, send=0.4)
    # One glassy tick under each letter as it rises.
    for i, note in enumerate([86, 88, 90, 93, 95, 98]):
        music.add(celesta(note, 0.16, 1.2), TITLE + 0.055 * i + 0.12, pan=-0.35 + 0.14 * i, send=0.75)
    music.add(piano(81, 0.3), 4.95, pan=0.2, send=0.5)
    music.add(piano(78, 0.27), 5.30, pan=-0.1, send=0.5)

    # ---- dawn: high voices lift it, the light arrives as a soft wash
    music.add(pad([74, 78, 81, 88], DAWN, 7.0, attack=1.0, release=0.8,
                  bright=lambda t: 0.6 + 0.0 * t), 0, gain=0.32, send=0.6)
    wash = noise_burst(2.2, 1800, 7000, 0.9, 0.7, seed=21)
    fx.add(wash, DAWN + 0.1, gain=0.025, pan=-0.2, send=0.6)
    music.add(celesta(90, 0.3), DAWN + 0.45, pan=-0.25, send=0.8)
    music.add(piano(86, 0.3), DAWN + 0.62, pan=0.1, send=0.6)
    music.add(piano(81, 0.26), 6.55, pan=0.2, send=0.6)

    # ---- mix
    ir = hall()
    send = music.send + fx.send + air.send
    wet = np.stack([fftconvolve(send[:, 0], ir[:, 0])[:N], fftconvolve(send[:, 1], ir[:, 1])[:N]], 1)
    mix = music.dry + fx.dry + air.dry + wet * 0.32
    mix = highpass(mix.T, 45).T
    # Air: lift the top so it shines on laptop speakers.
    mix = mix + highpass(mix.T, 4500).T * 0.45
    # Gentle glue: soft knee, then the ending fades to silence.
    peak = np.abs(mix).max()
    mix = mix / peak * 1.25
    mix = np.tanh(mix) / np.tanh(1.25)
    mix *= smooth(T / 0.06)[:, None] * smooth((DUR - T - 0.05) / 1.0)[:, None]
    mix *= 10 ** (-1.0 / 20) / np.abs(mix).max()
    stems = {'music': music.dry, 'fx': fx.dry, 'air': air.dry, 'wet': wet * 0.32}
    return mix, stems


def write_score(path, duration=DUR):
    mix, _ = render()
    with wave.open(str(path), 'wb') as out:
        out.setparams((2, 2, R, 0, 'NONE', 'not compressed'))
        out.writeframes(np.rint(np.clip(mix, -1, 1) * 32767).astype('<i2').tobytes())


if __name__ == '__main__':
    mix, stems = render()
    for k, v in stems.items():
        print(f'{k:6s} rms {20 * np.log10(np.sqrt(np.mean(v ** 2)) + 1e-12):6.1f} dB  peak {20 * np.log10(np.abs(v).max() + 1e-12):6.1f} dB')
    print('mix rms', 20 * np.log10(np.sqrt(np.mean(mix ** 2))))
    write_score(sys.argv[1] if len(sys.argv) > 1 else 'out/score3.wav')
