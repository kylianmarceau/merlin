"""Instruments, ambience and mixing for the onboarding film scores (48 kHz stereo).

Everything is synthesized here: a felt piano, a celesta, warm pads, a hall
reverb, the falcon's wingbeats, and the ambience of each place (surf, lapping
water, wind, birdsong, crickets, distant cowbells).
"""
import wave

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

R = 48000


def hz(note):
    return 440.0 * 2 ** ((note - 69) / 12)


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def band(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], btype='band', fs=R, output='sos'), x, axis=0)


def lowpass(x, f, order=2):
    return sosfilt(butter(order, f, btype='low', fs=R, output='sos'), x, axis=0)


def highpass(x, f, order=2):
    return sosfilt(butter(order, f, btype='high', fs=R, output='sos'), x, axis=0)


def pan_gains(p):
    a = (np.clip(p, -1, 1) + 1) * np.pi / 4
    return np.cos(a), np.sin(a)


class Mix:
    def __init__(self, duration, seed=1):
        self.dur = duration
        self.n = int(duration * R)
        self.t = np.arange(self.n) / R
        self.dry = np.zeros((self.n, 2))
        self.send = np.zeros((self.n, 2))
        self.rng = np.random.default_rng(seed)

    def add(self, sig, t0, gain=1.0, pan=0.0, send=0.3):
        i0 = int(round(t0 * R))
        if i0 >= self.n:
            return
        if sig.ndim == 1:
            gl, gr = pan_gains(pan)
            sig = np.stack([sig * gl, sig * gr], 1)
        j0 = max(0, -i0)
        i0c = max(0, i0)
        m = min(len(sig) - j0, self.n - i0c)
        if m <= 0:
            return
        self.dry[i0c:i0c + m] += sig[j0:j0 + m] * gain
        self.send[i0c:i0c + m] += sig[j0:j0 + m] * gain * send

    def full(self, sig, gain=1.0, send=0.1):
        """A whole-length stereo bed."""
        self.add(sig[: self.n], 0, gain=gain, send=send)

    def render(self, wet=0.32, air=0.45):
        ir = hall(seed=7)
        w = np.stack([fftconvolve(self.send[:, c], ir[:, c])[: self.n] for c in range(2)], 1)
        mix = self.dry + w * wet
        mix = highpass(mix, 45)
        mix = mix + highpass(mix, 4500) * air
        mix = mix / (np.abs(mix).max() + 1e-9) * 1.25
        mix = np.tanh(mix) / np.tanh(1.25)
        t = self.t
        mix *= (smooth(t / 0.06) * smooth((self.dur - t - 0.05) / 1.0))[:, None]
        return mix * 10 ** (-1.0 / 20) / (np.abs(mix).max() + 1e-9)

    def write(self, path, **kw):
        mix = self.render(**kw)
        with wave.open(str(path), 'wb') as out:
            out.setparams((2, 2, R, 0, 'NONE', 'not compressed'))
            out.writeframes(np.rint(np.clip(mix, -1, 1) * 32767).astype('<i2').tobytes())


def hall(length=3.4, seed=7):
    n = int(length * R)
    t = np.arange(n) / R
    r = np.random.default_rng(seed)
    ir = np.zeros((n, 2))
    for ch in range(2):
        x = r.normal(size=n)
        for lo, hi, decay in [(60, 300, 2.4), (300, 1500, 2.0), (1500, 5000, 1.3), (5000, 14000, 0.6)]:
            ir[:, ch] += band(x, lo, hi) * np.exp(-t * 6.9 / decay)
        ir[:, ch] *= smooth(t / 0.035)
    ir = np.concatenate([np.zeros((int(0.022 * R), 2)), ir])
    for d, g in [(0.011, 0.5), (0.019, 0.35), (0.029, 0.3), (0.041, 0.22)]:
        ir[int(d * R), 0] += g
        ir[int(d * 1.13 * R), 1] += g
    return ir / np.sqrt(np.sum(ir ** 2) / 2)


# ---------------------------------------------------------------- instruments

_rng = np.random.default_rng(20261125)


def piano(note, vel=0.6, length=4.5):
    f = hz(note)
    n = int(length * R)
    t = np.arange(n) / R
    out = np.zeros(n)
    for k in range(1, 13):
        fk = k * f * np.sqrt(1 + 0.00035 * k * k)
        if fk > 12000:
            break
        amp = k ** -1.35 * np.exp(-(k - 1) * (0.62 - 0.3 * vel))
        tau = np.clip(3.4 / (1 + 0.5 * (k - 1)) * (220 / f) ** 0.4, 0.12, 7.0)
        env = 0.6 * np.exp(-t / (tau * 0.35)) + 0.4 * np.exp(-t / (tau * 1.6))
        ph = _rng.uniform(0, 2 * np.pi)
        out += amp * env * 0.5 * (np.sin(2 * np.pi * fk * 0.99935 * t + ph) + np.sin(2 * np.pi * fk * 1.00065 * t + ph * 1.3))
    out *= 1 - np.exp(-t / 0.0045)
    out += lowpass(_rng.normal(size=n) * np.exp(-t / 0.007), 1400) * 0.25
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
        out += amp * np.exp(-t / tau) * np.sin(2 * np.pi * f * ratio * (t + vib) + _rng.uniform(0, 6.28))
    out *= 1 - np.exp(-t / 0.0025)
    out *= 1 - smooth((t - (length - 0.3)) / 0.3)
    return out * vel * 0.6


def pad(mix, notes, t0, t1, attack=0.8, release=1.2, bright=0.3, gain=1.0, send=0.35):
    """Warm detuned voices. bright is a number or a function of time in [0, 1]."""
    i0 = int(max(0, t0 - 0.01) * R)
    i1 = min(mix.n, int((t1 + release * 3) * R))
    t = mix.t[i0:i1]
    env = smooth((t - t0) / attack) * np.where(t > t1, np.exp(-(t - t1) / release), 1.0)
    b = bright(t) if callable(bright) else np.full_like(t, bright)
    expo = 2.7 - 1.5 * b
    out = np.zeros((len(t), 2))
    for note in notes:
        f = hz(note)
        kmax = int(min(14, 7000 / f))
        for ch in (0, 1):
            for det in ((-7, 4) if ch == 0 else (-4, 7)):
                fd = f * 2 ** (det / 1200)
                rate = _rng.uniform(0.1, 0.25)
                drift = 0.0006 / (2 * np.pi * rate) * np.sin(2 * np.pi * rate * t + _rng.uniform(0, 6))
                ph0 = _rng.uniform(0, 2 * np.pi, kmax)
                for k in range(1, kmax + 1):
                    out[:, ch] += np.exp(-expo * np.log(k)) * np.sin(2 * np.pi * fd * k * (t + drift) + ph0[k - 1])
    out *= env[:, None] * gain / (len(notes) * 2.2)
    mix.add(out, t[0], send=send)


def noise_burst(length, lo, hi, attack, decay, seed=None):
    r = np.random.default_rng(seed)
    n = int(length * R)
    t = np.arange(n) / R
    x = band(r.normal(size=n), lo, hi)
    env = smooth(t / attack) * np.exp(-np.maximum(t - attack, 0) / decay)
    return x * env / (np.std(x) + 1e-9)


def whoosh(length, seed):
    n = int(length * R)
    t = np.arange(n) / R
    x = np.random.default_rng(seed).normal(size=n)
    hi = band(x, 900, 3200)
    lo = band(x, 160, 700)
    u = t / length
    env = smooth(u / 0.35) * (1 - smooth((u - 0.35) / 0.65)) ** 1.5
    sig = (hi * (1 - u) * 0.5 + lo * (0.6 + 0.6 * u)) * env
    return sig / (np.std(sig) + 1e-9)


def wings(mix, strokes, ref_scale=150, gain=0.17):
    """A whoosh on every downstroke, panned to the bird, louder when it is close."""
    for i, (t, p, sc) in enumerate(strokes):
        g = min(1.4, (sc / ref_scale) ** 0.9)
        mix.add(whoosh(0.24, 100 + i), t - 0.02, gain=gain * g, pan=p * 0.9, send=0.18)


def mark_sting(mix, settle, chord, bell, gain=0.95):
    """A reversed bloom into the chord as the bird becomes the mark."""
    sting = np.zeros(int(3.5 * R))
    for note, vel in chord:
        sting += piano(note, vel, 3.5)
    sting += celesta(bell, 0.4, 3.5) * 0.6
    ir = hall()
    tail = np.stack([fftconvolve(sting, ir[:, c])[: int(1.1 * R)] for c in range(2)], 1)
    rev = tail[::-1] * smooth(np.linspace(0, 1, len(tail)))[:, None] ** 1.4
    mix.add(rev / np.abs(rev).max(), settle - len(rev) / R, gain=0.11, send=0.1)
    mix.add(sting, settle, gain=gain, send=0.4)
    sub = np.sin(2 * np.pi * hz(chord[0][0] - 12) * np.arange(int(2.5 * R)) / R) * np.exp(-np.arange(int(2.5 * R)) / R / 0.9)
    mix.add(sub * smooth(np.arange(len(sub)) / R / 0.03), settle, gain=0.07, send=0.05)
    riser = noise_burst(1.0, 2500, 9000, 0.95, 0.03, seed=11)
    mix.add(riser * np.linspace(0.2, 1, len(riser)) ** 2, settle - 0.98, gain=0.035, send=0.5)


def ticks(mix, start, notes, gain=0.16):
    for i, note in enumerate(notes):
        mix.add(celesta(note, gain, 1.2), start + 0.055 * i + 0.12, pan=-0.35 + 0.14 * i, send=0.75)


# ---------------------------------------------------------------- ambience

def wind(mix, gain=0.15, lo=(90, 420), hi=(900, 2600), env=None, seed=3):
    r = np.random.default_rng(seed)
    t = mix.t
    x = r.normal(size=(mix.n, 2))
    gust = 0.55 + 0.25 * np.sin(2 * np.pi * 0.17 * t + 1) + 0.2 * np.sin(2 * np.pi * 0.41 * t + 2.3)
    a = band(x, *lo)
    b = band(x, *hi)
    swirl = 0.5 + 0.5 * np.sin(2 * np.pi * 0.23 * t)[:, None] * np.float64([1, -1])
    w = a / a.std() * 0.55 + b / b.std() * 0.22 * swirl
    e = gust * (env(t) if env is not None else smooth(t / 0.9))
    mix.full(w * e[:, None], gain=gain, send=0.05)


def sea(mix, crashes, gain=0.2, seed=5):
    """A breathing sea bed and surf that breaks at the given times (t, pan, size)."""
    r = np.random.default_rng(seed)
    t = mix.t
    x = r.normal(size=(mix.n, 2))
    bed = lowpass(x, 500) + band(x, 500, 1800) * 0.3
    swell = 0.6 + 0.4 * np.sin(2 * np.pi * t / 3.1 - 1.2)
    mix.full(bed / bed.std() * (swell * smooth(t / 0.8))[:, None], gain=gain * 0.4, send=0.08)
    for i, (t0, p, size) in enumerate(crashes):
        n = int(2.6 * R)
        tt = np.arange(n) / R
        y = r.normal(size=n)
        boom = lowpass(y, 380) * np.exp(-tt / 0.5) * smooth(tt / 0.12)
        wash_ = band(y, 1200, 7000) * smooth((tt - 0.1) / 0.5) * np.exp(-np.maximum(tt - 0.6, 0) / 0.7)
        s = boom / boom.std() * 0.8 + wash_ / wash_.std() * 0.35
        mix.add(s * smooth(tt / 0.05), t0, gain=gain * size, pan=p, send=0.3)


def lapping(mix, start=0.0, gain=0.05, pan=-0.3, seed=9):
    r = np.random.default_rng(seed)
    t = start
    while t < mix.dur:
        n = int(r.uniform(0.08, 0.2) * R)
        tt = np.arange(n) / R
        f0 = r.uniform(250, 700)
        s = band(r.normal(size=n), f0, f0 * 2.2) * np.sin(np.pi * tt / tt[-1]) ** 2
        mix.add(s / (s.std() + 1e-9), t, gain=gain * r.uniform(0.4, 1.0), pan=pan + r.normal(0, 0.25), send=0.25)
        t += r.uniform(0.18, 0.6)


def birdsong(mix, start, end, gain=0.03, pan=0.4, seed=12, kind='lark'):
    """A distant songbird: runs of short, fast-sweeping notes."""
    r = np.random.default_rng(seed)
    t = start
    while t < end:
        phrase = r.integers(4, 11)
        base = r.uniform(2600, 4200) if kind == 'lark' else r.uniform(1800, 3000)
        for _ in range(phrase):
            d = r.uniform(0.035, 0.09)
            n = int(d * R)
            tt = np.arange(n) / R
            f1, f2 = base * r.uniform(0.8, 1.3), base * r.uniform(0.7, 1.4)
            f = f1 + (f2 - f1) * (tt / d) ** r.uniform(0.5, 2)
            f = f * (1 + 0.04 * np.sin(2 * np.pi * r.uniform(40, 90) * tt))
            ph = 2 * np.pi * np.cumsum(f) / R
            s = (np.sin(ph) + 0.15 * np.sin(2 * ph)) * np.sin(np.pi * tt / d) ** 2
            mix.add(s, t, gain=gain * r.uniform(0.5, 1), pan=pan + r.normal(0, 0.1), send=0.5)
            t += d + r.uniform(0.01, 0.06)
        t += r.uniform(0.25, 0.9)


def crickets(mix, start, end, gain=0.02, seed=14, voices=4):
    r = np.random.default_rng(seed)
    for v in range(voices):
        f = r.uniform(3800, 5200)
        p = r.uniform(-0.8, 0.8)
        t = start + r.uniform(0, 0.5)
        g = gain * r.uniform(0.5, 1)
        while t < end:
            for k in range(int(r.integers(3, 5))):
                n = int(0.018 * R)
                tt = np.arange(n) / R
                s = np.sin(2 * np.pi * f * tt) * np.sin(np.pi * tt / tt[-1]) ** 2
                mix.add(s, t + k * 0.034, gain=g, pan=p, send=0.35)
            t += r.uniform(0.45, 0.8)


def cowbell(mix, t0, gain=0.03, pan=0.5, f=640, seed=16):
    n = int(2.5 * R)
    tt = np.arange(n) / R
    r = np.random.default_rng(seed)
    s = np.zeros(n)
    for ratio, a, tau in [(1, 1, 0.9), (1.483, 0.6, 0.6), (2.09, 0.4, 0.35), (2.94, 0.25, 0.2), (4.1, 0.1, 0.1)]:
        s += a * np.exp(-tt / tau) * np.sin(2 * np.pi * f * ratio * tt + r.uniform(0, 6))
    s *= 1 - np.exp(-tt / 0.002)
    mix.add(lowpass(s, 3000), t0, gain=gain, pan=pan, send=0.7)


def shimmer(mix, t0, t1, notes, gain=0.02, send=0.8):
    """High glassy voices, for light in the sky."""
    i0, i1 = int(t0 * R), min(mix.n, int(t1 * R))
    t = mix.t[i0:i1]
    env = smooth((t - t0) / 1.2) * smooth((t1 - t) / 1.0)
    out = np.zeros((len(t), 2))
    for j, note in enumerate(notes):
        f = hz(note)
        for ch in range(2):
            trem = 0.6 + 0.4 * np.sin(2 * np.pi * (0.3 + 0.17 * j + 0.05 * ch) * t + j)
            out[:, ch] += np.sin(2 * np.pi * f * (1 + 0.0015 * (ch - 0.5)) * t + j) * trem
    mix.add(out * env[:, None] / len(notes), t0, gain=gain, send=send)
