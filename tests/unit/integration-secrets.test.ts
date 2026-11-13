import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const load = async () => import("@/lib/integrations/secrets");

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("credential encryption", () => {
  it("round-trips, and the stored form never contains the secret", async () => {
    vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    const { encryptSecret, decryptSecret, encryptionReady } = await load();
    expect(encryptionReady()).toBe(true);
    const stored = encryptSecret("moodle-token-1234567890");
    expect(stored.startsWith("v1.")).toBe(true);
    expect(stored).not.toContain("moodle-token");
    expect(decryptSecret(stored)).toBe("moodle-token-1234567890");
    // A new random IV each time: the same secret never looks the same twice.
    expect(encryptSecret("moodle-token-1234567890")).not.toBe(stored);
  });

  it("refuses a tampered value, a different key, and plain text from before encryption", async () => {
    vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "a".repeat(64));
    const first = await load();
    const stored = first.encryptSecret("secret");
    const parts = stored.split(".");
    parts[3] = Buffer.from("tampered!").toString("base64url");
    expect(() => first.decryptSecret(parts.join("."))).toThrow(/can't be decrypted/);
    expect(() => first.decryptSecret("plain-token")).toThrow(/paste the token again/);
    vi.resetModules();
    vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "b".repeat(64));
    const second = await load();
    expect(() => second.decryptSecret(stored)).toThrow(/server key changed/);
  });

  it("won't store credentials without a key, or with a key that is too short", async () => {
    vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "");
    let m = await load();
    expect(m.encryptionReady()).toBe(false);
    expect(() => m.encryptSecret("x")).toThrow(/INTEGRATION_ENCRYPTION_KEY/);
    vi.resetModules();
    vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", "short");
    m = await load();
    expect(m.encryptionReady()).toBe(false);
  });
});

describe("what a failed test means", () => {
  it("maps messages to connection statuses", async () => {
    const { statusFromError } = await load();
    expect(statusFromError("Moodle refused access (401). Check the token.")).toBe("auth_failed");
    expect(statusFromError("Moodle didn't accept the token. Create a new one…")).toBe("auth_failed");
    expect(statusFromError("The token's user isn't allowed to do this.")).toBe("permission_denied");
    expect(statusFromError("Moodle answered 503.")).toBe("unavailable");
    expect(statusFromError("The operation was aborted due to timeout")).toBe("unavailable");
    expect(statusFromError("Couldn't find moodle.example.invalid.")).toBe("connection_failed");
    expect(statusFromError("No token is saved. Edit the connection and paste the Moodle token.")).toBe("incomplete");
  });
});
