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

const FRAME_W = 1080;
const FRAME_H = 1920;

function coverLayout(srcW: number, srcH: number): VideoLayout {
  const scale = Math.max(FRAME_W / srcW, FRAME_H / srcH);
  const width = srcW * scale;
  const height = srcH * scale;
  return {
    width,
    height,
    left: (FRAME_W - width) / 2,
    top: (FRAME_H - height) / 2,
  };
}

export function reframeStyle(
  track: CropKeyframe[],
  timeSec: number,
  srcW: number,
  srcH: number
): VideoLayout {
  if (track.length === 0) {
    return coverLayout(srcW, srcH);
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

  const s = FRAME_W / cropW;
  const width = srcW * s;
  const height = srcH * s;
  const left = FRAME_W / 2 - cx * s;
  const top = FRAME_H / 2 - cy * s;

  return { width, height, left, top };
}
