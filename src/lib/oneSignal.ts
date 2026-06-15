// OneSignal native push initialization (Capacitor only).
// Safe no-op when running in the browser/web preview.

import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';

const ONESIGNAL_APP_ID = 'be926903-6bc2-43a0-8be0-e66249b2a72a';

let initialized = false;

export function normalizeParentPhone(raw: string): string {
  return raw.replace(/\D+/g, '').slice(-10);
}

export function notifyNativeParentLogin(parentPhone: string): void {
  const externalId = normalizeParentPhone(parentPhone);
  if (externalId.length < 10) return;
  if ((window as any).ReactNativeWebView) {
    (window as any).ReactNativeWebView.postMessage(JSON.stringify({
      type: 'LOGIN',
      phoneNumber: externalId,
      externalId,
      rawPhone: parentPhone,
    }));
  }
}

export function notifyNativeParentLogout(): void {
  if ((window as any).ReactNativeWebView) {
    (window as any).ReactNativeWebView.postMessage(JSON.stringify({ type: 'LOGOUT' }));
  }
}

export async function initOneSignal(): Promise<void> {
  if (initialized) return;
  if (!Capacitor.isNativePlatform()) return; // skip on web

  try {
    // Dynamic import so web build doesn't try to resolve the cordova plugin
    const mod: any = await import('onesignal-cordova-plugin');
    const OneSignal = mod.default ?? mod.OneSignal ?? mod;

    OneSignal.initialize(ONESIGNAL_APP_ID);

    // iOS / Android 13+ permission prompt
    OneSignal.Notifications.requestPermission(true).catch(() => {});

    OneSignal.Notifications.addEventListener('click', (event: any) => {
      const url: string | undefined = event?.notification?.additionalData?.url;
      if (url) window.location.href = url;
    });

    initialized = true;
  } catch (err) {
    console.warn('[OneSignal] init skipped:', err);
  }
}

/**
 * Associate the current OneSignal subscription with a parent user (phone).
 * Call this after a parent successfully logs in.
 */
export async function linkOneSignalToParent(parentPhone: string): Promise<void> {
  notifyNativeParentLogin(parentPhone);
  if (!Capacitor.isNativePlatform()) return;
  try {
    const externalId = normalizeParentPhone(parentPhone);
    if (externalId.length < 10) return;

    await initOneSignal();

    const mod: any = await import('onesignal-cordova-plugin');
    const OneSignal = mod.default ?? mod.OneSignal ?? mod;

    await OneSignal.login(externalId);
    OneSignal.User.addTag('role', 'parent');
    OneSignal.User.addTag('phone', externalId);

    // Optionally persist subscription id to backend
    try {
      const subId: string | undefined =
        OneSignal.User?.pushSubscription?.id ??
        (await OneSignal.User?.pushSubscription?.getIdAsync?.());
      if (subId) {
        await supabase.functions.invoke('parent-api', {
          body: { action: 'register_push', onesignal_id: subId, phone: externalId },
        }).catch(() => {});
      }
    } catch {
      /* ignore */
    }
  } catch (err) {
    console.warn('[OneSignal] link skipped:', err);
  }
}

export async function logoutOneSignal(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const mod: any = await import('onesignal-cordova-plugin');
    const OneSignal = mod.default ?? mod.OneSignal ?? mod;
    OneSignal.logout();
  } catch {
    /* ignore */
  }
}
