# Muscit (music transcriber)

A web app that helps musicians learn songs by ear: load a song, loop a section,
slow it down without changing pitch, and isolate instrument stems (vocals,
drums, bass, guitar, piano, other) to hear parts clearly.

## Stack
- Frontend: React 19 + TypeScript + Vite + Tailwind, in `frontend/`.
  Deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main`.
- Audio: Web Audio API + signalsmith-stretch (time-stretch, pitch shift and
  gapless looping on the audio thread). Per-song work saved in IndexedDB (idb-keyval).
- Stem separation (not started): Demucs, run in the browser first. See design below.
- Later: Docker for self-hosting.

## Current state
- Player v1 works: open a file or YouTube link, waveform, sections and markers,
  A–B loop, speed and pitch with pitch preservation, recents, projects saved per song.
- `StemMixer` UI exists but is disabled: `App.tsx` passes `backendReady={false}`.
- YouTube mode can't use stems (YouTube doesn't share raw audio):
  `YouTubePlayer.capabilities.stems` is false. Stems are for uploaded files only.
- TypeScript pinned to ~6.0 because typescript-eslint doesn't support TS 7 yet.
- Pushed to github.com/yanu-ai/musict.

## Stem separation design (decided)
One **Separator** interface (audio in, stems out, progress reported) with three
implementations. The rest of the app never cares which one ran.

Order of preference:
1. **Local server**: used when the app is self-hosted and the server responds.
   Preferred because the user chose to self-host: no quotas, bigger models
   (htdemucs_ft, maybe a RoFormer "HQ mode"), fast on NVIDIA GPUs (Linux/Windows).
   Docker on a Mac can't reach the GPU, so it's CPU-only there (better quality, slower).
   The server reports its device and models so the UI can say what it's using.
2. **Browser**: Demucs exported to ONNX, run with onnxruntime-web on WebGPU
   (WASM fallback), e.g. via the `demucs-web` package. Default on the public site.
   Costs $0 at any scale and the audio never leaves the device.
3. **ZeroGPU**: a Hugging Face Space (Gradio + `@spaces.GPU`) for devices that
   can't run it locally. Each visitor has a small daily GPU quota.

A setting lets the user override: Automatic / This browser / Local server.

Model: Demucs. `htdemucs` (4 stems) or `htdemucs_6s` (adds guitar and piano,
which are weaker). Test both before choosing the default. RoFormer models are
better quality but large and some weights are non-commercial: server-only, later.

Rules:
- Ask before downloading the model (~80 MB). Download on first "Separate", not on
  page load. Host it on the Hugging Face Hub with a versioned filename.
- Cache stems per song so nothing is separated twice.
- Servers delete uploaded audio right after processing and never store or re-serve it.
- One Python separation app (Gradio) serves both ZeroGPU and the Docker backend.
- No Kubernetes: there are no servers of our own to orchestrate.

Open questions (decide when we get there):
- Stem playback: one multichannel signalsmith-stretch node vs one per stem,
  keeping stems in sync with speed, pitch and loop.
- Stem storage size: 6 stereo float32 stems of a 4-minute song is ~500 MB.
  Compress before caching.
- Cache key: `Track.id` is name + size; a content hash would be safer.
- Max song length for separation (the engine allows 20 minutes; memory won't).

## Build plan
1. Browser separator: `demucs-web` (4 stems) separating an uploaded file,
   behind the Separator interface.
2. Stem playback: wire stems into the engine and enable `StemMixer`
   (level, mute, solo), in sync with speed, pitch and loop.
3. Try `htdemucs_6s` and pick the default stem set.
4. UX: download consent, progress, cancel, caching.
5. Measure on a few devices; write up the tradeoffs in the README.
6. Docker level 1: frontend served by nginx (multi-stage build).
7. Gradio separation app, tested locally on the Mac.
8. Deploy it to ZeroGPU as the public fallback.
9. Docker level 2: docker compose with frontend + separation server for self-hosters.

## How I want to work
- I'm learning as I build. Go one step at a time and explain new concepts briefly.
- Don't run ahead: ask before creating files, installing packages, or running
  multi-step changes. Let me type commands myself when it helps me learn.
- Plan the player screen's features and design before writing UI code.
- Commit to Git after each small thing works.
