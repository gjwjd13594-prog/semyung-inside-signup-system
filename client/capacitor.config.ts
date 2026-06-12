import { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.semyunginside.app",
  appName: "세명인사이드",
  webDir: "dist",
  server: {
    // 개발 중 라이브 리로드: url: "http://192.168.x.x:5173", cleartext: true
  },
  plugins: {
    PushNotifications: { presentationOptions: ["badge", "sound", "alert"] },
  },
};

export default config;
