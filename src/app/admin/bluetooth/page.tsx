import Link from "next/link";
import { ActionForm } from "@/components/form";
import { Card, CardTitle, Field, PageHeader, Select, Stat } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { saveBluetoothPolicy } from "./actions";

export const metadata = { title: "Bluetooth check-in" };

const STRENGTHS = [
  [-80, "-80 dBm · small rooms, strict"],
  [-85, "-85 dBm"],
  [-90, "-90 dBm · most lecture halls (recommended)"],
  [-95, "-95 dBm"],
  [-100, "-100 dBm · very large halls, lenient"],
] as const;

type Ev = { data: { points?: number; counted?: boolean; matched?: number } };

export default async function BluetoothPage() {
  const { supabase, institutionId } = await requireRole("institution_admin");
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [{ data: st, error }, { data: ev }] = await Promise.all([
    supabase.from("institution_settings").select("bluetooth_enabled, bluetooth_min_rssi").eq("institution_id", institutionId).maybeSingle(),
    supabase.from("attendance_evidence").select("data").eq("institution_id", institutionId).eq("kind", "bluetooth").gte("created_at", since).limit(5000),
  ]);
  const settings = st as { bluetooth_enabled: boolean; bluetooth_min_rssi: number } | null;
  const rows = (ev ?? []) as Ev[];
  const confirmed = rows.filter((r) => (r.data.points ?? 0) >= 30).length;
  const decided = rows.filter((r) => r.data.counted).length;

  return (
    <>
      <PageHeader title="Bluetooth check-in" subtitle="Extra evidence that a student is in the room, for venues where GPS is weak indoors." />
      {error || !settings ? (
        <Card><p className="text-sm text-muted">Bluetooth check-in needs the latest database update (migration 0037).</p></Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardTitle>Policy</CardTitle>
            <ActionForm action={saveBluetoothPolicy} submit="Save">
              <label className="flex items-start gap-3 rounded-lg border border-line p-3">
                <input type="checkbox" name="enabled" defaultChecked={settings.bluetooth_enabled} className="mt-1 size-4" />
                <span><span className="block text-sm font-medium">Allow Bluetooth check-in</span>
                  <span className="text-xs text-muted">Off by default. When on, each lecturer chooses per session whether to use it.</span></span>
              </label>
              <Field label="Faintest signal that counts as in the room" hint="A stronger setting (closer to -40) means students must be nearer the lecturer's phone.">
                <Select name="min_rssi" defaultValue={String(settings.bluetooth_min_rssi)}>
                  {STRENGTHS.some(([v]) => v === settings.bluetooth_min_rssi) ? null
                    : <option value={settings.bluetooth_min_rssi}>{settings.bluetooth_min_rssi} dBm</option>}
                  {STRENGTHS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
              </Field>
            </ActionForm>
          </Card>
          <div className="grid content-start gap-3">
            <Stat label="Check-ins with Bluetooth (30 days)" value={rows.length} />
            <Stat label="Room confirmed by Bluetooth" value={confirmed} hint={decided ? `${decided} where it did better than GPS` : undefined} />
          </div>
        </div>
      )}

      <Card className="mt-6">
        <CardTitle>How it works</CardTitle>
        <div className="grid gap-4 text-sm md:grid-cols-2">
          <div className="space-y-2">
            <p>The lecturer opens the session in the <b>UniAttend Android app</b> on their phone and taps <i>Broadcast from this phone</i>.
              The phone sends a Bluetooth signal that changes every 20 seconds, signed with the session&apos;s own key like the live QR.
              No beacons or other hardware are needed, and nothing has to be set up per venue.</p>
            <p>When a student scans the QR in the Android app, their phone listens for a few seconds and sends what it heard. The database
              checks the signal is this class&apos;s current one. A signal from another room, another university or from earlier is worth nothing.</p>
          </div>
          <ul className="list-disc space-y-1.5 pl-5 text-muted">
            <li><b className="text-ink">It only adds.</b> The location points become the better of GPS and Bluetooth. The live QR is still required.</li>
            <li><b className="text-ink">Never an absence.</b> A weak or missing signal only sends the check-in to <Link href="/admin/review" className="text-accent">review</Link>.</li>
            <li><b className="text-ink">Phones.</b> Android 7 or newer with the app. iPhones and browsers can&apos;t take part yet and check in as before.</li>
            <li><b className="text-ink">Permission.</b> Android asks for &ldquo;Nearby devices&rdquo; (Android 11 and older: location), only where this is on.</li>
            <li><b className="text-ink">Battery.</b> Students listen for about 4 seconds per check-in. The lecturer&apos;s phone broadcasts only while the session page is open.</li>
            <li><b className="text-ink">Privacy.</b> Only a summary is kept with the record (how many readings matched and the strongest signal). See the <Link href="/privacy" className="text-accent">privacy notice</Link>.</li>
          </ul>
        </div>
      </Card>
    </>
  );
}
