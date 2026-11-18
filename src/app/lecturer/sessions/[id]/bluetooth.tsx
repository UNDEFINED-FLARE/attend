"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { Submit } from "@/components/form";
import { Icon } from "@/components/icons";
import { bluetoothAvailable, startBroadcast, stopBroadcast } from "@/lib/bluetooth";
import { bleToken, setSessionBluetooth } from "../../bluetooth-actions";

type State = { error?: string; ok?: string } | undefined;

/**
 * The Bluetooth room signal for one session. Turning it on lets students' phones
 * (UniAttend Android app) confirm they are in the room when GPS is weak indoors.
 * The broadcast itself comes from the lecturer's own Android phone, with this page
 * open in the app; the value changes every 20 seconds, like the live QR.
 */
export function BluetoothSignal({ session, on, open }: { session: string; on: boolean; open: boolean }) {
  const [state, run] = useActionState<State, FormData>(setSessionBluetooth, undefined);
  const [canBroadcast, setCanBroadcast] = useState(false);
  const [live, setLive] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setCanBroadcast(bluetoothAvailable()); }, []);

  useEffect(() => {
    if (!live) return;
    let stopped = false;
    const tick = async () => {
      const t = await bleToken(session).catch(() => ({ open: false, error: "No connection." }) as Awaited<ReturnType<typeof bleToken>>);
      if (stopped) return;
      if (!t.open || !t.bluetooth || !t.id) {
        setProblem(t.error ?? (t.open ? "Bluetooth is off for this session." : "The session is not open."));
        setLive(false);
        return;
      }
      try {
        await startBroadcast(t.id);
        setProblem(null);
      } catch (e) {
        setProblem(e instanceof Error ? e.message : "The broadcast could not start.");
        setLive(false);
        return;
      }
      timer.current = setTimeout(() => void tick(), Math.max(1000, t.refresh_in_ms ?? 20_000) + 150);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer.current) clearTimeout(timer.current);
      void stopBroadcast();
    };
  }, [live, session]);

  // Turning the session's Bluetooth off, or closing the session, stops the broadcast.
  useEffect(() => { if (!on || !open) setLive(false); }, [on, open]);

  return (
    <div className="rounded-2xl bg-bg p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-semibold"><Icon name="bluetooth" size={16} />Bluetooth room signal</p>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${on ? "bg-ok/15 text-ok" : "bg-line text-muted"}`}>{on ? "On" : "Off"}</span>
      </div>
      <p className="mt-0.5 text-xs text-muted">
        Helps confirm students are in the room when GPS is weak indoors. Students need the UniAttend Android app;
        anyone without it checks in as usual, and a weak or missing signal only ever sends a check-in to review.
      </p>
      <form action={run} className="mt-2">
        <input type="hidden" name="session" value={session} /><input type="hidden" name="on" value={on ? "0" : "1"} />
        <Submit label={on ? "Turn off for this session" : "Turn on for this session"} pending="…" variant="secondary" />
      </form>
      {state?.error && <p className="mt-2 text-xs font-medium text-bad">{state.error}</p>}
      {on && open && (canBroadcast ? (
        <div className="mt-3 space-y-2">
          {live ? (
            <p className="flex items-center gap-2 text-xs font-medium text-ok"><span className="size-2 animate-pulse rounded-full bg-ok" />
              Broadcasting from this phone. Keep this screen open near the front of the room.</p>
          ) : (
            <p className="text-xs text-muted">This phone can broadcast the signal. It uses little battery and stops when you leave this page.</p>
          )}
          <button type="button" onClick={() => setLive((l) => !l)}
            className={`h-10 w-full rounded-xl font-semibold ${live ? "bg-surface text-ink" : "bg-accent text-white"}`}>
            {live ? "Stop broadcasting" : "Broadcast from this phone"}
          </button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted">
          To broadcast, open this session in the <b className="text-ink">UniAttend Android app</b> on your phone and tap
          &ldquo;Broadcast from this phone&rdquo;. The QR can stay on the projector as usual.
        </p>
      ))}
      {problem && <p className="mt-2 text-xs font-medium text-warn">{problem}</p>}
    </div>
  );
}
