/// <reference lib="webworker" />
import type { FromWorker, ToWorker } from '../shared/protocol';
import { MediaEngine } from './MediaEngine';

/**
 * Media worker entry point. Owns fetching, demuxing, decoding, A/V sync and
 * WebGPU rendering, so none of it can ever cost the UI thread a frame.
 */
declare const self: DedicatedWorkerGlobalScope;

const post = (msg: FromWorker, transfer: Transferable[] = []) => self.postMessage(msg, transfer);
const engine = new MediaEngine(post);

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'init':
        void engine.init(msg.canvas, msg.telemetry, msg.width, msg.height);
        break;
      case 'load':
        void engine.load(msg.source);
        break;
      case 'play':
        engine.play();
        break;
      case 'pause':
        engine.pause();
        break;
      case 'seek':
        engine.seek(msg.time);
        break;
      case 'resize':
        engine.resize(msg.width, msg.height);
        break;
      case 'set-render-mode':
        engine.setRenderMode(msg.mode);
        break;
      case 'set-picture':
        engine.setPicture(msg.picture);
        break;
      case 'set-view':
        engine.setView(msg.view);
        break;
      case 'set-loop':
        engine.setLoop(msg.loop);
        break;
      case 'step-frame':
        engine.stepFrame(msg.direction);
        break;
      case 'snapshot':
        engine.snapshot();
        break;
      case 'audio-latency':
        engine.setOutputLatency(msg.seconds);
        break;
      case 'dispose':
        engine.dispose();
        self.close();
        break;
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err), fatal: false });
  }
};
