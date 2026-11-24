import { ANALYSIS_RATE } from "@/lib/music/detect";

/** The length of an audio or video file in seconds, from its metadata; null when the file doesn't say. */
export function mediaDuration(file: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
    el.preload = "metadata";
    const done = (v: number | null) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : null);
    el.onerror = () => done(null);
    el.src = url;
  });
}

/** The sound of a file mixed to one channel at the analysis rate. */
export async function decodeMono(file: Blob): Promise<Float32Array> {
  const data = await file.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, ANALYSIS_RATE);
  const buffer = await ctx.decodeAudioData(data);
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < ch.length; i++) out[i]! += ch[i]! / buffer.numberOfChannels;
  }
  return out;
}

/** Sends the recording and its score; resolves to the new score's id. */
export function uploadScore(
  file: Blob,
  fileName: string,
  meta: object,
  onProgress: (fraction: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.set("audio", file, fileName);
    form.set("score", JSON.stringify(meta));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/scores");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: { score?: { id: string }; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // not JSON
      }
      if (xhr.status === 201 && body.score) resolve(body.score.id);
      else reject(new Error(body.error ?? "The upload didn't go through."));
    };
    xhr.onerror = () => reject(new Error("The upload didn't go through. Check your connection."));
    xhr.send(form);
  });
}
