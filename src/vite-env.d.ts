/// <reference types="vite/client" />
declare module '*.glb' {
  const src: string;
  export default src;
}
declare module '*.mp3' {
  const src: string;
  export default src;
}
declare const __BUILD_ID__: string;
