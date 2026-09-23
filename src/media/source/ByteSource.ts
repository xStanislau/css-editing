import type { MediaSourceInput } from '../../shared/protocol';

/**
 * Random-access byte stream abstraction.
 *
 * The demuxer never downloads the whole file: it asks for a stream starting at
 * an arbitrary offset (moov at the end, seeking, resuming after backpressure)
 * and aborts it the moment it needs to jump somewhere else.
 */
export interface ByteSource {
  /** Total size in bytes if known. */
  readonly size: number | undefined;
  readonly name: string;
  open(offset: number, signal: AbortSignal): Promise<ReadableStreamDefaultReader<Uint8Array>>;
}

export function createByteSource(input: MediaSourceInput): ByteSource {
  return input.kind === 'file' ? new FileByteSource(input.file) : new HttpByteSource(input.url);
}

class FileByteSource implements ByteSource {
  readonly size: number;
  readonly name: string;
  constructor(private readonly file: File) {
    this.size = file.size;
    this.name = file.name;
  }

  async open(offset: number): Promise<ReadableStreamDefaultReader<Uint8Array>> {
    return this.file.slice(offset).stream().getReader();
  }
}

class HttpByteSource implements ByteSource {
  size: number | undefined;
  readonly name: string;
  private rangeSupported = true;

  constructor(private readonly url: string) {
    this.name = decodeURIComponent(new URL(url, self.location.href).pathname.split('/').pop() || url);
  }

  async open(offset: number, signal: AbortSignal): Promise<ReadableStreamDefaultReader<Uint8Array>> {
    const headers: HeadersInit = offset > 0 || this.rangeSupported ? { Range: `bytes=${offset}-` } : {};
    const res = await fetch(this.url, { headers, signal, mode: 'cors' });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} fetching ${this.url}`);

    if (res.status === 206) {
      const total = res.headers.get('Content-Range')?.split('/')[1];
      if (total && total !== '*') this.size = Number(total);
      return res.body.getReader();
    }

    // 200: server ignored Range. Only acceptable when we wanted offset 0;
    // otherwise skip bytes client-side (slow, but correct).
    this.rangeSupported = false;
    const len = res.headers.get('Content-Length');
    if (len) this.size = Number(len);
    const reader = res.body.getReader();
    return offset === 0 ? reader : skipBytes(reader, offset);
  }
}

function skipBytes(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  count: number,
): ReadableStreamDefaultReader<Uint8Array> {
  let toSkip = count;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return controller.close();
        if (toSkip >= value.byteLength) {
          toSkip -= value.byteLength;
          continue;
        }
        controller.enqueue(toSkip ? value.subarray(toSkip) : value);
        toSkip = 0;
        return;
      }
    },
    cancel: (reason) => reader.cancel(reason),
  }).getReader();
}
