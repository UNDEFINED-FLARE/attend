// App lock: after signing in once with a password, the app can be reopened with
// the device's own fingerprint, face or screen lock instead.
//
// * In the UniAttend Android app: the phone's BiometricPrompt (Capacitor plugin), which
//   accepts a fingerprint or face, or the phone's own screen lock (PIN, pattern or
//   password) — so it also works on a phone with no biometrics enrolled.
// * In a browser: the device's built-in authenticator (Windows Hello, Touch ID,
//   Android fingerprint) through a passkey created only for this lock.
//
// UniAttend never sees or stores a fingerprint, face or template: the operating
// system checks it and only answers "verified" or "not verified". What is kept
// on the device is the setting below (and, for browsers, the passkey's id).
// It is a lock for an already signed-in app, not a replacement for the account
// password, which stays the way back in (and the only way on a new device).

export const LOCK_KEY = "ua_lock";          // localStorage: the setting
export const UNLOCKED_KEY = "ua_unlocked";  // sessionStorage: unlocked in this app session
export const HIDDEN_KEY = "ua_hidden_at";   // sessionStorage: when the app went to the background

export type LockMethod = "native" | "passkey";
export type LockConfig = { v: 1; userId: string; method: LockMethod; credId?: string; after: 0 | 1 | 5 | 15; label: string };

type Cap = { isNativePlatform?: () => boolean; isPluginAvailable?: (n: string) => boolean };
const cap = () => (typeof window === "undefined" ? undefined : (window as unknown as { Capacitor?: Cap }).Capacitor);
export const inNativeApp = () => !!cap()?.isNativePlatform?.();

const safe = <T>(f: () => T, fallback: T): T => { try { return f(); } catch { return fallback; } };

export function readLock(): LockConfig | null {
  return safe(() => {
    const c = JSON.parse(localStorage.getItem(LOCK_KEY) ?? "null") as LockConfig | null;
    return c && c.v === 1 && typeof c.userId === "string" && (c.method === "native" || c.method === "passkey") ? c : null;
  }, null);
}
export function writeLock(c: LockConfig | null) {
  safe(() => (c ? localStorage.setItem(LOCK_KEY, JSON.stringify(c)) : localStorage.removeItem(LOCK_KEY)), undefined);
}
export function markUnlocked() {
  safe(() => { sessionStorage.setItem(UNLOCKED_KEY, "1"); sessionStorage.removeItem(HIDDEN_KEY); }, undefined);
}
export function markLocked() { safe(() => sessionStorage.removeItem(UNLOCKED_KEY), undefined); }

/** Whether the lock should be showing now for this user. */
export function shouldLock(userId: string): boolean {
  const c = readLock();
  if (!c || c.userId !== userId) return false;
  return safe(() => {
    if (sessionStorage.getItem(UNLOCKED_KEY) !== "1") return true;
    const hidden = Number(sessionStorage.getItem(HIDDEN_KEY) || 0);
    return hidden > 0 && Date.now() - hidden >= c.after * 60_000;
  }, true);
}

export type Support = { method: LockMethod; label: string } | { method: null; reason: string };

/** What the phone will ask for, in words (BiometryType values from the plugin). */
export function nativeLabel(type: number, hasBiometric: boolean): string {
  if (!hasBiometric) return "screen lock (PIN, pattern or password)";
  if (type === 3 || type === 1) return "fingerprint or screen lock";           // FINGERPRINT, TOUCH_ID
  if (type === 4 || type === 2) return "face or screen lock";                  // FACE_AUTHENTICATION, FACE_ID
  return "fingerprint, face or screen lock";
}

/** What this device can use. */
export async function lockSupport(): Promise<Support> {
  if (inNativeApp()) {
    if (!cap()?.isPluginAvailable?.("NativeBiometric")) return { method: null, reason: "Update the UniAttend app to use fingerprint or face unlock." };
    try {
      const { NativeBiometric, BiometryType, AuthenticationStrength } = await import("@capgo/capacitor-native-biometric");
      // useFallback: a screen lock alone (PIN, pattern, password) is enough.
      const r = await NativeBiometric.isAvailable({ useFallback: true });
      if (!r.isAvailable) return { method: null, reason: "Set up a screen lock (PIN, pattern or password) on your phone first, in its Security settings." };
      return { method: "native", label: nativeLabel(r.biometryType, r.authenticationStrength !== AuthenticationStrength.NONE && r.biometryType !== BiometryType.NONE && r.biometryType !== BiometryType.DEVICE_CREDENTIAL) };
    } catch {
      return { method: null, reason: "Fingerprint unlock isn't available on this phone." };
    }
  }
  try {
    if (typeof PublicKeyCredential === "undefined" || !window.isSecureContext) return { method: null, reason: "This browser can't use your device's fingerprint or face." };
    // Some browsers never answer this; treat silence as "not available".
    const ok = await Promise.race([
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(),
      new Promise<boolean>((r) => setTimeout(() => r(false), 5000)),
    ]);
    return ok ? { method: "passkey", label: "fingerprint, face or device PIN" } : { method: null, reason: "This device has no fingerprint, face or Windows Hello set up." };
  } catch {
    return { method: null, reason: "This browser can't use your device's fingerprint or face." };
  }
}

const b64u = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

/** Browser only: create the passkey this lock uses. Returns its id. */
export async function createPasskey(displayName: string): Promise<string> {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: random(32),
      rp: { name: "UniAttend" },
      // A random handle, not the account id: the passkey says nothing about who you are.
      user: { id: random(16), name: `UniAttend app lock (${displayName})`, displayName: `UniAttend app lock · ${displayName}` },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
      timeout: 60_000,
      attestation: "none",
    },
  }) as PublicKeyCredential | null;
  if (!cred) throw new Error("cancelled");
  return b64u(cred.rawId);
}

export class LockError extends Error {
  constructor(message: string, readonly kind: "cancelled" | "failed" | "unavailable") { super(message); }
}

/** Ask the device to confirm it's the owner. Resolves only when the OS says so. */
export async function verifyOwner(c: Pick<LockConfig, "method" | "credId">, reason = "Unlock UniAttend"): Promise<void> {
  if (c.method === "native") {
    if (!inNativeApp() || !cap()?.isPluginAvailable?.("NativeBiometric")) throw new LockError("Fingerprint unlock isn't available here.", "unavailable");
    const { NativeBiometric, BiometryType } = await import("@capgo/capacitor-native-biometric");
    try {
      // Any enrolled biometric, or the phone's PIN, pattern or password. Android checks it
      // all on the phone (BiometricPrompt); the app only learns "verified" or not. With the
      // screen lock allowed Android shows no Cancel button: back or a swipe cancels.
      await NativeBiometric.verifyIdentity({
        reason, title: reason, subtitle: "Use your fingerprint, face or screen lock", maxAttempts: 5,
        allowedBiometryTypes: [BiometryType.FINGERPRINT, BiometryType.FACE_AUTHENTICATION, BiometryType.IRIS_AUTHENTICATION, BiometryType.DEVICE_CREDENTIAL],
      });
      return;
    } catch (e) {
      // The plugin's BiometricAuthError codes.
      const code = Number((e as { code?: string | number }).code ?? 0);
      if ([11, 15, 16, 17].includes(code)) throw new LockError("Not verified.", "cancelled");      // app/system/user cancel, fallback
      if (code === 2 || code === 4) throw new LockError("Your phone has paused unlock checks after too many tries. Use your password, or try again later.", "unavailable");
      if (code === 1 || code === 3 || code === 14) throw new LockError("This phone has no screen lock, fingerprint or face set up any more. Use your password.", "unavailable");
      throw new LockError("Not verified.", "failed");
    }
  }
  if (!c.credId) throw new LockError("Set up the lock again.", "unavailable");
  const challenge = random(32);
  let cred: PublicKeyCredential | null;
  try {
    cred = await navigator.credentials.get({
      publicKey: { challenge, allowCredentials: [{ type: "public-key", id: fromB64u(c.credId) }], userVerification: "required", timeout: 60_000 },
    }) as PublicKeyCredential | null;
  } catch (e) {
    throw new LockError("Not verified.", (e as DOMException).name === "NotAllowedError" ? "cancelled" : "failed");
  }
  if (!cred) throw new LockError("Not verified.", "cancelled");
  const res = cred.response as AuthenticatorAssertionResponse;
  const client = JSON.parse(new TextDecoder().decode(res.clientDataJSON)) as { type: string; challenge: string };
  const flags = new Uint8Array(res.authenticatorData)[32];
  // The answer must be for this request, and the device must have checked the person (UV flag).
  if (client.type !== "webauthn.get" || client.challenge !== b64u(challenge.buffer) || !(flags & 0x04)) {
    throw new LockError("Not verified.", "failed");
  }
}
