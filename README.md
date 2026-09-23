# Prism: a WebGPU video player without `<video>`

A web video player that never touches the HTML5 `<video>` element. Bytes are
fetched, demuxed and decoded in a Web Worker with **WebCodecs**. Frames are
drawn with **WebGPU** on an `OffscreenCanvas`, and audio plays through an
**AudioWorklet** fed by a lock-free `SharedArrayBuffer` ring. The worklet's
read cursor is the master clock.

```
 UI thread (React)              Media worker                          Audio thread
 ─────────────────              ────────────                          ────────────
 <canvas> ──transferControlToOffscreen──▶ WebGpuRenderer ◀─┐
 PlayerController ──postMessage (control only)──▶ MediaEngine │
   │                            ByteSource (fetch Range / File)  │
   │                              └▶ Mp4Demuxer (mp4box.js)      │ VideoFrame
   │                                  ├▶ VideoDecodePipe ────────┘   (bounded queue)
   │                                  └▶ AudioDecodePipe ──PCM──▶ AudioRing (SAB) ──▶ pcm-player worklet
   │                              MediaClock ◀──── read cursor ─────────────────────────┘
   └── rAF reads Telemetry (SAB) ◀── playhead, buffer, stats ── MediaEngine
```

## Why it's fast

| Concern | Approach |
| --- | --- |
| UI jank | The main thread only runs React and receives low-rate control messages. Playhead, buffer and stats come from a SharedArrayBuffer read in the UI's own rAF, applied as compositor-only transforms. No React re-renders while playing. |
| Decode | Hardware decoding first (`prefer-hardware`), software fallback. Decoded frames are capped at 8, since each VideoFrame pins a decoder surface. Frames are closed the moment they become unusable. |
| Render | Zero-copy `importExternalTexture`, which does YUV→RGB in the sampler. It uses one quad and one bind group per frame. The canvas is sized in device pixels via `devicePixelContentBoxSize`, so the compositor never rescales it. |
| A/V sync | Audio drives the clock: `mediaTime = anchor + (readCursor − anchorCursor) / sampleRate − outputLatency`. When the network stalls, the worklet starves, the clock stops and video waits. Bluetooth latency is compensated. |
| Startup | Progressive parsing shows the first frame before the download finishes. `moov`-at-end files jump straight to the index with HTTP Range requests. |
| Seeking | The in-flight request is aborted and reopened at the keyframe offset. Pre-roll frames are decoded but hidden, so the landing is frame-accurate. The last frame stays on screen (no black flash), and scrubbing is coalesced to one seek per display frame. |
| Resilience | Hidden tabs keep audio fed from a timer when rAF stops. Lost GPU devices are rebuilt with backoff and a retry budget. Undecodable audio falls back to a muted wall clock. When audio ends before video, a wall-clock tail finishes the video. |

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build && npm run preview
npm run sample     # regenerate public/samples (needs ffmpeg)
```

Requires Chrome/Edge 113+ (WebGPU + WebCodecs + OffscreenCanvas + AudioWorklet).
If something is missing, the app shows a capability report instead of the player.

### Deployment: cross-origin isolation is required

`SharedArrayBuffer` needs these headers on the HTML document (the Vite dev and
preview servers already send them):

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

Remote media URLs must allow CORS. They should also support `Range` requests,
which fast seeking and `moov`-at-end files rely on.

## Source map

```
src/
  shared/            imported by more than one thread; no environment globals
    protocol.ts      typed UI <-> worker messages
    audioRing.ts     SPSC PCM ring over SAB (+ flush-on-seek handshake)
    telemetry.ts     seqlocked worker -> UI stats block
  media/             Web Worker
    media.worker.ts  entry / message router
    MediaEngine.ts   orchestration, state machine, buffering, frame selection
    source/          ByteSource: HTTP Range or File, random access
    demux/           Demuxer interface + Mp4Demuxer (mp4box.js)
    decode/          VideoDecodePipe / AudioDecodePipe with backpressure
    sync/            AudioMasterClock, WallClock
    render/          WebGpuRenderer, EnhanceGraph, WGSL shaders
  audio/
    pcm-player.worklet.ts   AudioWorkletProcessor (the master clock)
  player/            PlayerController (main-thread facade) + React hooks
  ui/                Tailwind components: player, seek bar, stats, source bar
```

## Injecting Anime4K

Press **E** (or click **Enhance**) to switch to the compute path:

```
VideoFrame ─ingest─▶ SOURCE (rgba16f) ─pass 1─▶ … ─pass N─▶ OUTPUT ─present─▶ canvas
```

1. Put each Anime4K pass in `src/media/render/shaders/` as a compute shader.
   `anime4k.placeholder.wgsl` is the marked injection point; it currently does
   a 2× bilinear upscale plus a light adaptive sharpen.
2. List the passes in `src/media/render/enhance/passes.ts`. For each pass, give
   the named input textures, the output texture and the scale relative to the
   source. Intermediate feature maps are allocated automatically.
3. Follow the binding convention: `@binding(0)` sampler (optional),
   `@binding(1..N)` inputs, `@binding(N+1)` rgba16float storage output,
   `@workgroup_size(8, 8)`.

Reference ports: [SegaraRai/anime4k-wgpu](https://github.com/SegaraRai/anime4k-wgpu).

## Keyboard

`Space`/`K` play · `←`/`→` ±5s · `J`/`L` ±10s · `0–9` jump · `↑`/`↓` volume · `M` mute ·
`E` enhance · `S` stats · `F` fullscreen

## Roadmap

- Playback rate (needs a WSOLA/phase-vocoder time-stretch in the worklet)
- MP4 edit lists / B-frame composition offset normalisation
- Fragmented MP4 over HLS/DASH (a new `Demuxer`; the rest of the pipeline is unchanged)
- Rust/WASM demuxer for MKV/WebM behind the same `Demuxer` interface
- HDR (PQ/HLG) with `display-p3` / `rgba16float` canvas and tone mapping
- Thumbnail previews on the seek bar from a second low-res decoder

The previous CSS live-editing demo now lives in `examples/css-live-editing/`.
