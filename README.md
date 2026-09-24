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
| Timing | Edit lists are applied, so B-frame delay, AAC priming and Opus pre-skip are removed, priming samples are dropped, and tracks line up exactly. |
| Containers | **MP4** (mp4box.js) and **MKV/WebM** (our own streaming parser): lacing, live WebM with unknown sizes, Cues-based seeking with a bitrate-estimate fallback, Opus CodecDelay, header stripping. The container is detected from its magic bytes. |
| Startup | Progressive parsing shows the first frame before the download finishes. `moov`-at-end files jump straight to the index with HTTP Range requests. |
| Seek previews | Hovering the seek bar shows **real decoded frames**. A separate preview decoder fetches just the needed keyframe by byte range (from the MP4 sample table or the MKV Cues) and scales it down. Results are cached, neighbours are prefetched, and local files are warmed up in advance. Clicking a previewed spot puts that frame on screen immediately while the exact frame decodes. |
| Subtitles | **ASS/SSA rendered by libass** (WebAssembly via JASSUB, in its own worker): styles, karaoke, `\move`, fades and positioning. Fonts embedded in MKV attachments are used. SRT/WebVTT tracks and external files (drag & drop or file picker) are converted to ASS. libass loads lazily, only when subtitles exist. Plain-text subtitles move above the controls; ASS typesetting stays locked to the picture. |
| Frame pacing | The audio clock advances in ~10 ms bursts, so a PLL smooths it. Frames are chosen for the vsync they will actually land on, using the measured refresh rate. The result is a clean 3:2 cadence for 24p on 60 Hz and a perfect 5:5 on 120 Hz, verified by a simulation test. Pacing jitter shows in the stats overlay. |
| Seeking | The in-flight request is aborted and reopened at the keyframe offset. Pre-roll frames are decoded but hidden, so the landing is frame-accurate. The last frame stays on screen (no black flash), and scrubbing is coalesced to one seek per display frame. |
| Resilience | Hidden tabs keep audio fed from a timer when rAF stops. Lost GPU devices are rebuilt with backoff and a retry budget. Undecodable audio falls back to a muted wall clock. When audio ends before video, a wall-clock tail finishes the video. |

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build && npm run preview
npm run sample     # regenerate public/samples (needs ffmpeg)

npm test           # unit tests (ring buffer, clocks, demuxer on real MP4s)
npm run test:e2e   # Playwright: load, play, A/V sync, seek, end (build + preview)
npm run test:perf  # performance & responsiveness report -> test-results/perf-report.json
```

The full engine needs Chrome/Edge 113+ (WebGPU + WebCodecs + OffscreenCanvas +
AudioWorklet). Other browsers get **compatibility mode**, which plays through a
plain `<video>` element and lists what's missing.

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
    demux/           Demuxer interface, Mp4Demuxer (mp4box.js), MkvDemuxer (EBML),
                     codec-string builders, container sniffing
    decode/          VideoDecodePipe / AudioDecodePipe with backpressure
    sync/            AudioMasterClock, WallClock
    render/          WebGpuRenderer, EnhanceGraph, WGSL shaders
  audio/
    pcm-player.worklet.ts   AudioWorkletProcessor (the master clock)
  player/            PlayerController (main-thread facade) + React hooks
  ui/                Tailwind components: player, seek bar, stats, source bar
```

## Performance budget

`npm run test:perf` measures the numbers below and fails on regressions. The
values are from a GPU-less CI container (software WebGPU): latency and
main-thread numbers hold, rendering FPS does not.

| Metric | Result | Budget |
| --- | --- | --- |
| First contentful paint (static HTML shell) | ~230 ms | < 300 ms |
| Time to first frame, MP4 / MKV | ~115 / ~85 ms | < 500 ms |
| Seek → exact frame (median / p95) | ~50 / ~70 ms | < 250 ms |
| Click on hovered spot → instant frame | ~6 ms | < 50 ms |
| Seek-bar preview, cold / cached | ~20 / ~2 ms | < 150 / < 30 ms |
| Main thread busy during playback | ~3 % of a core | < 10 % |
| Long tasks / total blocking time while playing | 0 / 0 ms | 0 / < 50 ms |
| Slowest input handler | ~7 ms | < 16 ms |
| Heap growth over a 35 s loop, VideoFrame leaks | ~0.1 MB, 0 | < 5 MB, 0 |
| 40 rapid seeks + scrub, 6 rapid source switches | recovers, 0 errors | — |

QoE is also exported at runtime as `performance.measure()` entries
(`prism:ttff`, `prism:seek`, `prism:seek-instant`, `prism:rebuffer`,
`prism:preview`) for real-user monitoring, and shown in the stats overlay.

## Pro tools

| Tool | How |
| --- | --- |
| Frame step | `,` / `.`. It's an accurate seek, so audio stays aligned when you resume, and holding the key walks frame by frame. |
| Save frame | `X` or the camera button. The PNG is rendered at full resolution as displayed, including enhancement and picture settings, and the filename carries the timecode and frame number. |
| A-B loop | `B` sets A, `B` again sets B, a third `B` clears. The range is drawn on the seek bar. |
| Picture | Brightness, contrast, saturation and sharpness sliders. They are applied in the present shader, so they cost no extra pass. Double-click a slider to reset it. |
| Zoom | Ctrl/⌘ + scroll or a trackpad pinch zooms around the cursor. Drag to pan, `+`/`−` to step, `Z` to reset. |
| Auto quality | If the enhancement graph drops over 20% of frames for 3s, the player falls back to the zero-copy path and says why. |

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

`Space`/`K` play · `←`/`→` ±5s · `J`/`L` ±10s · `0–9` jump · `,`/`.` frame step · `B` loop ·
`X` save frame · `C` subtitles · `+`/`−`/`Z` zoom · `↑`/`↓` volume · `M` mute · `E` enhance · `S` stats · `F` fullscreen

## Roadmap

- Playback rate (needs a WSOLA/phase-vocoder time-stretch in the worklet)
- Fragmented MP4 over HLS/DASH (a new `Demuxer`; the rest of the pipeline is unchanged)
- HDR (PQ/HLG) with `display-p3` / `rgba16float` canvas and tone mapping

The previous CSS live-editing demo now lives in `examples/css-live-editing/`.
