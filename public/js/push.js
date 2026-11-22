// Подписка на push-уведомления этого устройства.
import { get, post } from './api.js';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function registration() {
  return navigator.serviceWorker.ready;
}

export async function pushState() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await registration();
  const sub = await reg.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

/** Включить push на этом устройстве (спросит разрешение у браузера). */
export async function enablePush() {
  if (!pushSupported()) throw new Error('unsupported');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('denied');
  const { key } = await get('/api/push/key');
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)) });
  await post('/api/push/subscribe', sub.toJSON());
  return true;
}

export async function disablePush() {
  if (!pushSupported()) return;
  const reg = await registration();
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await post('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  }
}

/** При запуске: если разрешение уже есть — обновить подписку на сервере (могла смениться). */
export async function syncPush() {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    const reg = await registration();
    const sub = await reg.pushManager.getSubscription();
    if (sub) await post('/api/push/subscribe', sub.toJSON());
    else if (localStorage.getItem('gc-push') !== 'off') await enablePush();
  } catch { /* push необязателен */ }
}
