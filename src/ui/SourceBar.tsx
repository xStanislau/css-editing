import { useRef, useState } from 'react';
import type { MediaSourceInput } from '../shared/protocol';
import { UploadIcon } from './icons';

export const SAMPLE_URL = '/samples/sample-vp9-opus.mp4';

export function SourceBar({ onLoad }: { onLoad: (source: MediaSourceInput) => void }) {
  const [url, setUrl] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault();
        if (url.trim()) onLoad({ kind: 'url', url: url.trim() });
      }}
    >
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://… .mp4 / .mkv / .webm (CORS + Range enabled)"
        className="min-w-0 flex-1 rounded-xl bg-white/5 px-4 py-2.5 text-sm text-white ring-1 ring-white/10 outline-none placeholder:text-white/35 focus:ring-accent"
      />
      <div className="flex gap-2">
        <button type="submit" className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 active:scale-[.98]">
          Load URL
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/15"
        >
          <UploadIcon className="size-4" /> Open file
        </button>
        <button
          type="button"
          onClick={() => onLoad({ kind: 'url', url: SAMPLE_URL })}
          className="rounded-xl bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/15"
        >
          Sample
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="video/mp4,video/quicktime,video/x-matroska,video/webm,.mp4,.m4v,.mov,.mkv,.webm,.ass,.ssa,.srt,.vtt"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onLoad({ kind: 'file', file });
          e.target.value = '';
        }}
      />
    </form>
  );
}
