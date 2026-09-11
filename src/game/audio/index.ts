// STUB — replaced by the audio module (owner: audio fork). Must export `audio: AudioSystem`.
import type { AudioSystem, MusicState, MusicTrack } from './api';
const tracks: MusicTrack[] = [];
const state: MusicState = { index: 0, playing: false, time: 0, duration: 0, track: { title: '', artist: '', src: '' }, bars: new Array(16).fill(0) };
export const audio: AudioSystem = {
  unlock() {}, unlocked: false, setVolumes() {}, play() {},
  createEngine() { return { update() {}, stop() {} }; },
  duckMusic() {},
  music: { tracks, state, play() {}, pause() {}, toggle() {}, next() {}, prev() {}, seek() {}, setDsp() {}, subscribe() { return () => {}; } },
  loop() {}, stopAll() {},
};
