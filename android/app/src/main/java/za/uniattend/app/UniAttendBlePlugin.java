package za.uniattend.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanRecord;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.Collections;
import java.util.List;

/**
 * Bluetooth Low Energy for check-in evidence (src/lib/bluetooth.ts).
 *
 * Lecturer's phone: startAdvertising() broadcasts the session's current 8-byte value
 * as service data under UniAttend's service UUID. No device name, not connectable.
 * The web page calls it again every 20 seconds with the next value.
 *
 * Student's phone: scan() listens for a few seconds for that service only and returns
 * what it heard: the value and its signal strength. Nothing else (no addresses, no
 * other devices) leaves the plugin, and the server decides what it is worth.
 *
 * Android 12+: one "Nearby devices" permission (BLUETOOTH_SCAN, declared
 * neverForLocation, and BLUETOOTH_ADVERTISE). Android 11 and older need location to
 * scan, which check-in already asks for.
 */
@CapacitorPlugin(
    name = "UniAttendBle",
    permissions = {
        @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_ADVERTISE }),
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION })
    }
)
public class UniAttendBlePlugin extends Plugin {
    private static final int MAX_READINGS = 60;
    private final Handler main = new Handler(Looper.getMainLooper());
    private AdvertiseCallback advertising;

    private static boolean modernBluetooth() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S;
    }

    private String scanAlias() {
        return modernBluetooth() ? "bluetooth" : "location";
    }

    private BluetoothAdapter adapter() {
        BluetoothManager m = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return m == null ? null : m.getAdapter();
    }

    private static ParcelUuid uuidOf(PluginCall call) {
        try {
            return ParcelUuid.fromString(call.getString("serviceUuid", ""));
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static String hex(byte[] b, int n) {
        StringBuilder s = new StringBuilder(n * 2);
        for (int i = 0; i < n; i++) s.append(String.format("%02x", b[i] & 0xff));
        return s.toString();
    }

    private static byte[] unhex(String s) {
        if (s == null || !s.matches("^[0-9a-f]{16}$")) return null;
        byte[] out = new byte[8];
        for (int i = 0; i < 8; i++) out[i] = (byte) Integer.parseInt(s.substring(i * 2, i * 2 + 2), 16);
        return out;
    }

    // ---------------------------------------------------------------- listening

    @PluginMethod
    public void scan(PluginCall call) {
        if (getPermissionState(scanAlias()) != PermissionState.GRANTED) {
            requestPermissionForAlias(scanAlias(), call, "scanPermissionAnswered");
            return;
        }
        startScan(call);
    }

    @PermissionCallback
    private void scanPermissionAnswered(PluginCall call) {
        if (getPermissionState(scanAlias()) == PermissionState.GRANTED) startScan(call);
        else call.reject("Bluetooth permission was not given.", "denied");
    }

    @SuppressLint("MissingPermission")
    private void startScan(PluginCall call) {
        BluetoothAdapter a = adapter();
        if (a == null || !a.isEnabled()) {
            call.reject("Bluetooth is off.", "off");
            return;
        }
        BluetoothLeScanner scanner = a.getBluetoothLeScanner();
        ParcelUuid service = uuidOf(call);
        if (scanner == null || service == null) {
            call.reject("Bluetooth scanning is not available.", "unavailable");
            return;
        }
        int duration = Math.max(1000, Math.min(10000, call.getInt("durationMs", 4000)));
        final JSArray found = new JSArray();
        final ScanCallback cb = new ScanCallback() {
            @Override
            public void onScanResult(int type, ScanResult r) {
                add(r);
            }

            @Override
            public void onBatchScanResults(List<ScanResult> rs) {
                for (ScanResult r : rs) add(r);
            }

            @Override
            public void onScanFailed(int errorCode) {
                // Resolved with whatever was heard when the timer ends.
            }

            private void add(ScanResult r) {
                ScanRecord rec = r.getScanRecord();
                byte[] data = rec == null ? null : rec.getServiceData(service);
                if (data == null || data.length < 8) return;
                synchronized (found) {
                    if (found.length() >= MAX_READINGS) return;
                    JSObject o = new JSObject();
                    o.put("id", hex(data, 8));
                    o.put("rssi", r.getRssi());
                    found.put(o);
                }
            }
        };
        ScanFilter filter = new ScanFilter.Builder().setServiceData(service, new byte[0]).build();
        ScanSettings settings = new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build();
        try {
            scanner.startScan(Collections.singletonList(filter), settings, cb);
        } catch (SecurityException | IllegalStateException e) {
            call.reject("Bluetooth scanning could not start.", "unavailable");
            return;
        }
        main.postDelayed(() -> {
            try {
                scanner.stopScan(cb);
            } catch (SecurityException | IllegalStateException ignored) {
                // Bluetooth was turned off meanwhile: keep what was heard.
            }
            JSObject ret = new JSObject();
            synchronized (found) {
                ret.put("observations", found);
            }
            call.resolve(ret);
        }, duration);
    }

    // ---------------------------------------------------------------- broadcasting

    @PluginMethod
    public void startAdvertising(PluginCall call) {
        if (modernBluetooth() && getPermissionState("bluetooth") != PermissionState.GRANTED) {
            requestPermissionForAlias("bluetooth", call, "advertisePermissionAnswered");
            return;
        }
        advertise(call);
    }

    @PermissionCallback
    private void advertisePermissionAnswered(PluginCall call) {
        if (getPermissionState("bluetooth") == PermissionState.GRANTED) advertise(call);
        else call.reject("Bluetooth permission was not given.", "denied");
    }

    @SuppressLint("MissingPermission")
    private void advertise(PluginCall call) {
        BluetoothAdapter a = adapter();
        if (a == null || !a.isEnabled()) {
            call.reject("Bluetooth is off.", "off");
            return;
        }
        BluetoothLeAdvertiser advertiser = a.getBluetoothLeAdvertiser();
        ParcelUuid service = uuidOf(call);
        byte[] value = unhex(call.getString("id"));
        if (advertiser == null) {
            call.reject("This phone cannot broadcast Bluetooth.", "unsupported");
            return;
        }
        if (service == null || value == null) {
            call.reject("The class signal could not be read.", "invalid");
            return;
        }
        stopCurrent(advertiser);
        AdvertiseSettings settings = new AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_BALANCED)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(false)
            .setTimeout(0)
            .build();
        AdvertiseData data = new AdvertiseData.Builder()
            .setIncludeDeviceName(false)
            .setIncludeTxPowerLevel(false)
            .addServiceData(service, value)
            .build();
        AdvertiseCallback cb = new AdvertiseCallback() {
            @Override
            public void onStartSuccess(AdvertiseSettings s) {
                call.resolve();
            }

            @Override
            public void onStartFailure(int errorCode) {
                if (advertising == this) advertising = null;
                call.reject("Bluetooth broadcast could not start (" + errorCode + ").", "failed");
            }
        };
        advertising = cb;
        try {
            advertiser.startAdvertising(settings, data, cb);
        } catch (SecurityException | IllegalStateException e) {
            advertising = null;
            call.reject("Bluetooth broadcast could not start.", "failed");
        }
    }

    @SuppressLint("MissingPermission")
    private void stopCurrent(BluetoothLeAdvertiser advertiser) {
        if (advertising == null || advertiser == null) return;
        try {
            advertiser.stopAdvertising(advertising);
        } catch (SecurityException | IllegalStateException ignored) {
            // Already stopped.
        }
        advertising = null;
    }

    @PluginMethod
    public void stopAdvertising(PluginCall call) {
        BluetoothAdapter a = adapter();
        stopCurrent(a == null ? null : a.getBluetoothLeAdvertiser());
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        BluetoothAdapter a = adapter();
        stopCurrent(a == null ? null : a.getBluetoothLeAdvertiser());
        super.handleOnDestroy();
    }
}
