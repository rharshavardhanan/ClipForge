export interface CropKeyframe {
  time: number;
  cx: number;
  cy: number;
  cropW: number;
  cropH: number;
}

export interface VideoLayout {
  width: number;
  height: number;
  left: number;
  top: number;
}

function coverLayout(srcW: number, srcH: number, frameW: number, frameH: number): VideoLayout {
  const scale = Math.max(frameW / srcW, frameH / srcH);
  const width = srcW * scale;
  const height = srcH * scale;
  return {
    width,
    height,
    left: (frameW - width) / 2,
    top: (frameH - height) / 2,
  };
}

/**
 * @param frameW output composition width in px (default 1080, matches the 9:16/3:4 shared width)
 * @param frameH output composition height in px (default 1920 = 9:16; pass 1440 for 3:4).
 *   MUST be the real composition height (e.g. from useVideoConfig()), not assumed — a mismatch
 *   here mis-centers the crop vertically by half the height delta.
 */
export function reframeStyle(
  track: CropKeyframe[],
  timeSec: number,
  srcW: number,
  srcH: number,
  frameW = 1080,
  frameH = 1920
): VideoLayout {
  if (track.length === 0) {
    return coverLayout(srcW, srcH, frameW, frameH);
  }

  let cx: number;
  let cy: number;
  let cropW: number;

  if (timeSec <= track[0].time) {
    ({ cx, cy, cropW } = track[0]);
  } else if (timeSec >= track[track.length - 1].time) {
    ({ cx, cy, cropW } = track[track.length - 1]);
  } else {
    let i = 0;
    while (i < track.length - 1 && track[i + 1].time < timeSec) {
      i++;
    }
    const a = track[i];
    const b = track[i + 1];
    const span = b.time - a.time;
    const t = span > 0 ? (timeSec - a.time) / span : 0;
    cx = a.cx + (b.cx - a.cx) * t;
    cy = a.cy + (b.cy - a.cy) * t;
    cropW = a.cropW + (b.cropW - a.cropW) * t;
  }

  const s = frameW / cropW;
  const width = srcW * s;
  const height = srcH * s;
  const left = frameW / 2 - cx * s;
  const top = frameH / 2 - cy * s;

  return { width, height, left, top };
}
