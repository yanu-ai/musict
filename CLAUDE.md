# Muscit (music transcriber)

A web app that helps musicians learn songs by ear: load a song, loop a section,
slow it down without changing pitch, and isolate instrument stems (vocals,
drums, bass, guitar, piano, other) to hear parts clearly.

## Stack
- Frontend: React 19 + TypeScript + Vite + Tailwind, in `frontend/`.
  Hosted on Cloudflare Workers (static assets) at https://musict.davefol8.workers.dev,
  built and deployed by Cloudflare on every push to `main` (`frontend/wrangler.jsonc`).
- Audio: Web Audio API + signalsmith-stretch (time-stretch, pitch shift and
  gapless looping on the audio thread). Per-song work saved in IndexedDB (idb-keyval).
- Stem separation: HT-Demucs 6-stem (ONNX) in the browser with `onnxruntime-web`,
  in a Web Worker, with our own chunking (`frontend/src/separation/`). See design below.
- Later: Docker for self-hosting.

## Current state
- Player v1 works: open a file or YouTube link, waveform, sections and markers,
  A–B loop, speed and pitch with pitch preservation, recents, projects saved per song.
- Stems work for uploaded files (build plan steps 1–3 done): "Separate stems" with a
  one-time OK for the model download, then optional auto-start for new songs. The
  current loop is separated first and playable early; moving the loop moves the work.
  `StemMixer` faders, mute and solo drive per-stem volumes in the engine.
- **Known bug (next up):** moving the loop while separation continues causes a short
  silence when the new loop's stems load (clock keeps counting). Cause: `engine.setStems`
  drops the node's buffers, then `addBuffers` *copies* the whole song's 12 channels
  (no transfer list), so the node plays nothing in between: ~0.6–1 s for a 9.5-min song
  in testing, likely longer under memory pressure. Planned fix: (A) pass a transfer list
  `node.addBuffers(channels, channels.map((c) => c.buffer))` (also in `load()`), measure;
  (B) if still audible, gapless swap (append new buffers, jump input by an offset, then
  `dropBuffers(toSeconds)`); (C) skip reloads when the loop's stems are already loaded.
  Test with `window.musictEngine` (dev only) + AnalyserNodes on `engine.stemGains`.
- Separately: soloing/muting in parts not separated yet sounds silent or thin, because
  only Other carries the mix there. Consider playing the original there instead.
- YouTube mode can't use stems (YouTube doesn't share raw audio):
  `YouTubePlayer.capabilities.stems` is false. Stems are for uploaded files only.
- TypeScript pinned to ~6.0 because typescript-eslint doesn't support TS 7 yet.
- Pushed to github.com/yanu-ai/musict.

## Cross-origin isolation (decided)
Multi-threaded WASM needs the page to be cross-origin isolated (COOP `same-origin` +
COEP `require-corp`), but those headers block the YouTube embed (Chrome and Safari).
So the app is two addresses:
- `/`: home and file mode, **isolated** (fast separation).
- `/youtube/?v=<id>`: YouTube mode, **not isolated**.
Headers are set per path by `frontend/public/_headers` (Cloudflare) and a plugin in
`frontend/vite.config.ts` (dev/preview). Self-hosting (nginx) must do the same.
Moving between modes is a page load; a file opened from YouTube mode is handed to
`/` through IndexedDB (`saveHandoff`/`takeHandoff` in `lib/storage.ts`, routes in
`lib/routes.ts`).

## Stem separation design (decided)
One **Separator** interface (audio in, stems out, progress reported) with three
implementations. The rest of the app never cares which one ran.

Order of preference:
1. **Local server**: used when the app is self-hosted and the server responds.
   Preferred because the user chose to self-host: no quotas, bigger models
   (htdemucs_ft, maybe a RoFormer "HQ mode"), fast on NVIDIA GPUs (Linux/Windows).
   Docker on a Mac can't reach the GPU, so it's CPU-only there (better quality, slower).
   The server reports its device and models so the UI can say what it's using.
2. **Browser** (built: `BrowserSeparator`): HT-Demucs 6-stem exported to ONNX, run with
   onnxruntime-web (WASM, CPU) in a Web Worker. Default on the public site. Costs $0 at
   any scale and the audio never leaves the device. How it works:
   - `chunks.ts` cuts the song into 7.8 s chunks overlapping by 1/4, crossfaded so the
     overlaps sum to 1; chunks touching the loop go first (`nextChunk`).
   - The page sends one chunk at a time to the worker (`browser.worker.ts`), so the
     worker never holds the whole song; one worker per job, freed at the end.
   - ORT's graph optimizer runs out of memory on this model (`std::bad_alloc`), so
     `graphOptimizationLevel: 'disabled'`. ORT's 29.5 MB `.wasm` loads from jsDelivr
     (Cloudflare's 25 MiB file limit); its small `.mjs` must stay same-origin.
   - Speed on the M3 MacBook Air (8 GB), foreground tab, 4 threads: model load ~10 s,
     ~3.8 s per 7.8 s chunk (~2x real time). Auto-started jobs use 2 threads.
   - **Speed depends on Chrome treating the tab as foreground.** Background tabs get
     low OS priority (efficiency cores, ~6x slower). Timings from Claude's automated
     tab are unreliable; earlier "production build is 7x slower" was this artifact.
   - Without cross-origin isolation it's single-threaded and much slower.
   - Separation is capped at 10 minutes of audio (memory).
3. **ZeroGPU**: a Hugging Face Space (Gradio + `@spaces.GPU`) for devices that
   can't run it locally. Each visitor has a small daily GPU quota.

A setting lets the user override: Automatic / This browser / Local server.

Model (decided): `htdemucs_6s` (vocals, drums, bass, other, guitar, piano), the MIT
ONNX export by StemSplitio (`htdemucs_6s_fp16weights.onnx`, 136 MB). Piano is the
weakest stem. RoFormer models are better quality but large and some weights are
non-commercial: server-only, later.

Playback (decided): one 12-channel signalsmith-stretch node (6 stems × L/R) with a
GainNode per stem after stretching, so stems never drift and faders are instant.
"Other" is rebuilt as mix minus the other five, so stems sum exactly to the original
("stems off" = all gains 1). The engine runs at 44.1 kHz, the model's rate.

Rules:
- Ask before downloading the model (136 MB). Download on first "Separate", not on
  page load. TODO: host our own copy on the Hugging Face Hub with a versioned filename
  (it currently loads from StemSplitio's repo).
- Cache stems per song so nothing is separated twice.
- Servers delete uploaded audio right after processing and never store or re-serve it.
- One Python separation app (Gradio) serves both ZeroGPU and the Docker backend.
- No Kubernetes: there are no servers of our own to orchestrate.

Open questions (decide when we get there):
- Stem storage size: 6 stereo float32 stems of a 4-minute song is ~500 MB.
  Compress before caching.
- Cache key: `Track.id` is name + size; a content hash would be safer.
- Keep the worker (and loaded model) alive between songs to skip the ~10 s load?
- Pre-optimize the ONNX model offline (e.g. Colab) to win back the graph optimizer.

## Build plan
1. ~~Browser separator behind the Separator interface.~~ Done.
2. ~~Stem playback in the engine, `StemMixer` enabled.~~ Done.
3. ~~Try `htdemucs_6s` and pick the default stem set.~~ Done: 6-stem.
4. UX: ~~download consent, progress, cancel~~ (done); caching stems per song (todo),
   so reopening a song doesn't separate again.
5. Measure on a few devices; write up the tradeoffs in the README.
6. Docker level 1: frontend served by nginx (multi-stage build), with the same
   per-path isolation headers as `public/_headers`.
7. Gradio separation app, tested locally on the Mac.
8. Deploy it to ZeroGPU as the public fallback.
9. Docker level 2: docker compose with frontend + separation server for self-hosters.

## How I want to work
- I'm learning as I build. Go one step at a time and explain new concepts briefly.
- Don't run ahead: ask before creating files, installing packages, or running
  multi-step changes. Let me type commands myself when it helps me learn.
- Plan the player screen's features and design before writing UI code.
- Commit to Git after each small thing works.
