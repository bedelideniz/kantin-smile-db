import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.8c51069e18ba4f4594561e907c737ecc',
  appName: 'KantinPay Veli',
  webDir: 'dist',
  server: {
    url: 'https://8c51069e-18ba-4f45-9456-1e907c737ecc.lovableproject.com?forceHideBadge=true',
    cleartext: true,
  },
  plugins: {
    // OneSignal native plugin configuration is initialized in code (src/lib/oneSignal.ts)
  },
};

export default config;
