# spike/harness — the external speaker meter

This is the half of the step-1 instrument that measures **what the app wrote to
its audio device**, from **outside the app**. The other half — the RMS of the
captured `MediaStream`, measured inside the renderer — is `spike/host.html`.

Read [`docs/spike-capture-mute.md`](../../docs/spike-capture-mute.md) first. The
numbers these scripts produced are there, along with the Limitations section
that says what they do and do not establish.

## Why it is here

It used not to be. Until this commit these five files lived **only** in a
session scratchpad under `/tmp`, and `spike/bin/run-variant.sh` hardcoded that
path as its `AUDIO_HARNESS` default. Write-up Limitation 7:

> Once it is gone the committed evidence cannot be re-derived from this
> repository at all. … A gate that depends on a `/tmp` directory will VOID one
> day and be read as a pass by someone who is not looking carefully.

`spike/bin/*` now defaults to **this** directory. `AUDIO_HARNESS=/some/path`
still overrides it, so the original tree can still be used if it happens to
exist; nothing requires it to.

## What is in it

| | |
|---|---|
| `bin/env.sh` | shared settings: sink name, rate, channels, the lock. Sourced, not run. |
| `bin/sink.sh` | `create` / `destroy` / `status` / `id` / `env` an isolated PipeWire null sink |
| `bin/measure.sh` | record N seconds off that sink's **monitor** and print the RMS |
| `bin/rms.py` | RMS/peak/dBFS of a WAV. **Exits 3 when it cannot look** — an empty recording is an error, never a `0.0`. |
| `bin/pwnode.py` | look a PipeWire node up by `node.name` (parses `pw-dump`, never greps it) |
| `bin/pwlinks.py` | list every node linked into the sink's playback ports, with pid; `--pid N` exits 4 if anything else is writing |

The sink is a `support.null-audio-sink` adapter: apps write to its playback
ports, we read its monitor ports, and it is wired to **no hardware whatsoever**,
so nothing played into it can reach a speaker. That is what makes "the speakers
were silent" measurable on a box with no soundcard — and also what
[Limitation 3](../../docs/spike-capture-mute.md#limitations) means when it says
silence here has never been *heard*.

## The sink is machine-global. What the lock does and does not buy.

Any process on the box may link to any sink. There is no PipeWire primitive for
"this sink is mine". So exclusivity here is two cooperating halves:

- **A lock.** `env.sh:harness_lock` takes an `flock` on
  `$XDG_RUNTIME_DIR/stem-workbench-sink-<name>.lock` for the life of the run.
  Two runs of *this repo* cannot measure the same sink at once — which is the
  failure the reproducibility audit actually observed, a second agent's Electron
  writing into `harness_sink` mid-run.
- **A witness.** `pwlinks.py --pid <electron pid>` is sampled inside the
  measurement window and stored in the run record as `sinkWriters` /
  `foreignWriters`. A foreign writer does not fail the run — it is recorded and
  warned about loudly, and it is what the permanent gate's assertion 8 will
  assert on.

**Neither stops a non-cooperating process.** What closes that hole properly is
gate assertion 7 — asserting the *app's own* output node exists, names this pid
and targets the measured sink — which is tracked as a follow-up issue and is not
built here.

The default sink name is `stem_workbench_spike`, not `harness_sink`. The old
name is the machine's default sink for the whole user session (Limitation 10),
so measuring it means measuring whatever else the box decided to play.

## Requirements

`pipewire` (`pw-cli`, `pw-link`, `pw-record`, `pw-dump`), `python3` with
`numpy`, `flock`, `timeout`, and `ffmpeg` for `spike/bin/make-fixture.sh`.

## Provenance

Copied from the step-1 session scratchpad's `audio-harness/bin`. The five
original files are unchanged except for: `env.sh`'s sink-name default and the
`harness_lock` helper, and the `harness_lock` calls in `sink.sh`. `pwlinks.py`
is new. The scratchpad tree also held `all.sh`, `tone.sh`, `prove*.sh`,
`capture-vs-speakers.sh`, `display-check.sh`, `mutations.sh` and an `app/` — the
harness's own self-proofs, which proved the *harness*, not the spike. They are
deliberately not vendored: `spike/bin/` is the spike's own instrument, and a
second copy of a mutation runner would be a second thing to keep honest.
