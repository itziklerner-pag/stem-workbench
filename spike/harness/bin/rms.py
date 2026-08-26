#!/usr/bin/env python3
"""Print the RMS of a WAV file.

Reads WAVE_FORMAT_PCM (u8/s16/s24/s32), WAVE_FORMAT_IEEE_FLOAT (f32/f64) and
WAVE_FORMAT_EXTENSIBLE. Samples are normalised to [-1, 1] so the number means
the same thing whatever pw-record was asked for.

It EXITS NON-ZERO when it cannot look:
  - no data chunk / zero frames
  - fewer frames than --min-seconds (default 0.5)
An empty recording and a silent recording both have RMS 0. Reporting 0 for the
first one would be a measurement that cannot fail, so it is an error instead.
(AGENTS.md: "An assertion must FAIL when it cannot look.")

Usage: rms.py FILE.wav [--min-seconds S] [--json]
Prints: rms peak dbfs frames rate channels   (or JSON with --json)
"""
import sys, struct, json, math

def read_wav(path):
    with open(path, 'rb') as f:
        data = f.read()
    if len(data) < 12 or data[0:4] != b'RIFF' or data[8:12] != b'WAVE':
        raise ValueError(f'{path}: not a RIFF/WAVE file')
    pos, fmt, raw = 12, None, None
    while pos + 8 <= len(data):
        cid = data[pos:pos+4]
        (csz,) = struct.unpack('<I', data[pos+4:pos+8])
        body = data[pos+8:pos+8+csz]
        if cid == b'fmt ':
            fmt = body
        elif cid == b'data':
            # pw-record fixes the header up on exit, but if it was SIGKILLed the
            # size field can be stale: trust the file length, not the field.
            raw = data[pos+8:pos+8+csz] if pos+8+csz <= len(data) else data[pos+8:]
        pos += 8 + csz + (csz & 1)
    if fmt is None:
        raise ValueError(f'{path}: no fmt chunk')
    tag, ch, rate, _brate, _align, bits = struct.unpack('<HHIIHH', fmt[:16])
    if tag == 0xFFFE:                      # WAVE_FORMAT_EXTENSIBLE
        if len(fmt) < 40:
            raise ValueError(f'{path}: truncated extensible fmt chunk')
        tag = struct.unpack('<H', fmt[24:26])[0]
    if raw is None:
        raise ValueError(f'{path}: no data chunk')
    return tag, ch, rate, bits, raw

def to_float(tag, bits, raw):
    import numpy as np
    if tag == 3:                                    # IEEE float
        if bits == 32: return np.frombuffer(raw[:len(raw)//4*4], '<f4').astype(np.float64)
        if bits == 64: return np.frombuffer(raw[:len(raw)//8*8], '<f8').astype(np.float64)
    if tag == 1:                                    # PCM
        if bits == 8:
            return (np.frombuffer(raw, 'u1').astype(np.float64) - 128.0) / 128.0
        if bits == 16:
            return np.frombuffer(raw[:len(raw)//2*2], '<i2').astype(np.float64) / 32768.0
        if bits == 24:
            b = np.frombuffer(raw[:len(raw)//3*3], 'u1').reshape(-1, 3).astype(np.int32)
            v = (b[:,0] | (b[:,1] << 8) | (b[:,2] << 16))
            v = np.where(v & 0x800000, v - 0x1000000, v)
            return v.astype(np.float64) / 8388608.0
        if bits == 32:
            return np.frombuffer(raw[:len(raw)//4*4], '<i4').astype(np.float64) / 2147483648.0
    raise ValueError(f'unsupported WAV format tag={tag} bits={bits}')

def main(argv):
    import numpy as np
    if len(argv) < 2:
        print(__doc__.strip(), file=sys.stderr); return 2
    path = argv[1]
    min_seconds = 0.5
    as_json = '--json' in argv
    if '--min-seconds' in argv:
        min_seconds = float(argv[argv.index('--min-seconds') + 1])

    tag, ch, rate, bits, raw = read_wav(path)
    x = to_float(tag, bits, raw)
    ch = max(1, ch)
    frames = x.size // ch
    if frames == 0:
        print(f'MEASUREMENT FAILED: {path} has 0 frames — the recorder captured '
              f'nothing. This is not silence, it is a broken measurement.',
              file=sys.stderr)
        return 3
    seconds = frames / float(rate or 1)
    if seconds < min_seconds:
        print(f'MEASUREMENT FAILED: {path} holds {seconds:.3f}s, below the '
              f'{min_seconds:.3f}s floor — too short to carry a claim about the '
              f'sink. Raise the window or fix the recorder.', file=sys.stderr)
        return 3

    rms = float(math.sqrt(float(np.mean(x * x))))
    peak = float(np.max(np.abs(x)))
    dbfs = 20.0 * math.log10(rms) if rms > 0 else float('-inf')
    if as_json:
        # JSON has no -Infinity; emit null so JS consumers can parse this.
        print(json.dumps({'file': path, 'rms': rms, 'peak': peak,
                          'dbfs': dbfs if math.isfinite(dbfs) else None,
                          'frames': frames, 'seconds': seconds, 'rate': rate,
                          'channels': ch, 'bits': bits, 'format_tag': tag}))
    else:
        print(f'rms={rms:.9f} peak={peak:.9f} dbfs={dbfs:.2f} frames={frames} '
              f'seconds={seconds:.3f} rate={rate} channels={ch}')
    return 0

if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv))
    except Exception as e:
        print(f'MEASUREMENT FAILED: {e}', file=sys.stderr)
        sys.exit(3)
