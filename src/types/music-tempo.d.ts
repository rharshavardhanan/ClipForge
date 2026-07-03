declare module 'music-tempo' {
  export default class MusicTempo {
    constructor(audioData: Float32Array | number[], params?: Record<string, unknown>);
    tempo: string;    // library returns (60/interval).toFixed(3) — a string
    beats: number[];  // beat times in seconds
  }
}
