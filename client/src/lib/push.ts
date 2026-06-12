import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { api } from "../api/client";

export async function initPush() {
  if (!Capacitor.isNativePlatform()) return;

  const perm = await PushNotifications.requestPermissions();
  if (perm.receive !== "granted") return;

  await PushNotifications.register();

  PushNotifications.addListener("registration", ({ value }) => {
    api.post("/api/devices/token", { token: value, platform: Capacitor.getPlatform() });
  });

  PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const { type, link } = action.notification.data ?? {};
    if (link) {
      window.location.href = link;
    } else if (type === "NEW_MESSAGE") {
      window.location.href = "/";
    } else {
      window.location.href = "/notifications";
    }
  });
}
