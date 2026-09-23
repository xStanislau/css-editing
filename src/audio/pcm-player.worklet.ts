import { AudioRing } from '../shared/audioRing';

/**
 * Real-time audio sink. Runs on the browser's audio rendering thread.
 *
 * Pulls PCM that the media worker wrote into the shared ring, 128 frames per
 * render quantum. It never allocates, never locks and never talks to the
 * main thread: the read cursor it advances IS the player's master clock.
 */
class PcmPlayerProcessor extends AudioWorkletProcessor {
  private readonly ring: AudioRing;

  constructor(options: { processorOptions: { sab: SharedArrayBuffer } }) {
    super();
    this.ring = new AudioRing(options.processorOptions.sab);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (out && out.length > 0) this.ring.read(out);
    return true;
  }
}

registerProcessor('pcm-player', PcmPlayerProcessor);
