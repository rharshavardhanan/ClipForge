import { run } from './cmd.js';

export async function probe(videoPath: string) {
  const { stdout } = await run('ffprobe', [
    '-v', 'quiet', '-print_format', 'json',
    '-show_format', '-show_streams', videoPath,
  ]);
  const j = JSON.parse(stdout);
  const v = (j.streams as any[]).find((s) => s.codec_type === 'video');
  const [num, den] = String(v?.r_frame_rate ?? '30/1').split('/').map(Number);
  return {
    duration: Number(j.format?.duration ?? 0),
    width: Number(v?.width ?? 0),
    height: Number(v?.height ?? 0),
    fps: den ? num / den : Number(num) || 30,
    codec: String(v?.codec_name ?? 'unknown'),
  };
}

export async function runFfmpegNull(input: string, filter: string): Promise<string> {
  const { stderr } = await run('ffmpeg', ['-i', input, '-af', filter, '-f', 'null', '-']);
  return stderr;
}
