import { callSwing } from "@/lib/swing-api";

// Web Push client helpers. The VAPID public key comes from the edge
// function; the private key never leaves server_secrets.

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushState = "unsupported" | "denied" | "subscribed" | "unsubscribed";

export async function pushStatus(): Promise<PushState> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "subscribed" : "unsubscribed";
}

export async function enablePush(): Promise<void> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("This browser does not support Web Push.");
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notification permission was not granted.");
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const { publicKey } = await callSwing<{ publicKey: string }>("get_vapid_public");
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  const j = sub.toJSON();
  await callSwing("push_subscribe", { endpoint: j.endpoint, keys: j.keys });
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await callSwing("push_unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  }
}

export async function sendTestPush(): Promise<number> {
  const r = await callSwing<{ sent: number }>("push_test");
  return r.sent;
}
