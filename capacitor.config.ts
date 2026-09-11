import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ru.spg3d.game',
  appName: 'СПГ 3Д',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  android: { allowMixedContent: false, backgroundColor: '#0b0c10' },
};

export default config;
