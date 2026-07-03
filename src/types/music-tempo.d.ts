declare module 'music-tempo' {
  export default class MusicTempo {
    constructor(audioData: Float32Array | number[], params?: Record<string, unknown>);
    tempo: number;    // BPM
    beats: number[];  // beat times in seconds
  }
}
