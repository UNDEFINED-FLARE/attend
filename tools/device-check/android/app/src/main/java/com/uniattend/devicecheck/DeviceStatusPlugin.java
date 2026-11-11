package com.uniattend.devicecheck;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.content.Context;
import android.content.Intent;
import android.location.LocationManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.core.location.LocationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Reads Wi-Fi, Bluetooth and location-services state with Android's own system
 * services, and opens the matching system settings screens. Exposed to the web
 * app as the "DeviceStatus" plugin (see src/lib/deviceStatus.ts).
 */
@CapacitorPlugin(
    name = "DeviceStatus",
    permissions = {
        // Android 12+ runtime permissions for scanning and for turning Bluetooth on.
        @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT }),
        // Android 11 and lower need location permission to scan for Bluetooth devices.
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION })
    }
)
public class DeviceStatusPlugin extends Plugin {

    private static final boolean MODERN_BLUETOOTH = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S;

    private BluetoothAdapter adapter() {
        BluetoothManager bm = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return bm != null ? bm.getAdapter() : null;
    }

    // ------------------------------------------------------------------ status

    @SuppressWarnings("deprecation") // WifiManager.getConnectionInfo still returns the SSID with location permission.
    @SuppressLint("MissingPermission")
    @PluginMethod
    public void getStatus(PluginCall call) {
        Context ctx = getContext();
        JSObject ret = new JSObject();
        ret.put("platform", "android");

        JSObject wifi = new JSObject();
        WifiManager wm = (WifiManager) ctx.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (wm == null) {
            wifi.put("supported", false);
            wifi.put("enabled", null);
            wifi.put("connected", null);
            wifi.put("ssid", null);
            wifi.put("note", "This device has no Wi-Fi.");
        } else {
            boolean onWifi = false;
            if (cm != null) {
                Network active = cm.getActiveNetwork();
                NetworkCapabilities caps = active != null ? cm.getNetworkCapabilities(active) : null;
                onWifi = caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);
            }
            String ssid = null;
            if (onWifi) {
                WifiInfo info = wm.getConnectionInfo();
                String raw = info != null ? info.getSSID() : null;
                if (raw != null && !raw.equals(WifiManager.UNKNOWN_SSID)) ssid = raw.replace("\"", "");
            }
            wifi.put("supported", true);
            wifi.put("enabled", wm.isWifiEnabled());
            wifi.put("connected", onWifi);
            wifi.put("ssid", ssid);
            if (onWifi && ssid == null) wifi.put("note", "Allow location (GPS card) to see the Wi-Fi network name.");
        }
        ret.put("wifi", wifi);

        JSObject bt = new JSObject();
        BluetoothAdapter ad = adapter();
        bt.put("supported", ad != null);
        bt.put("enabled", ad != null ? ad.isEnabled() : null);
        if (ad == null) bt.put("note", "This device has no Bluetooth. (The emulator on this PC runs without Bluetooth; use a real phone.)");
        ret.put("bluetooth", bt);

        JSObject loc = new JSObject();
        LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
        loc.put("servicesEnabled", lm != null ? LocationManagerCompat.isLocationEnabled(lm) : null);
        ret.put("location", loc);

        call.resolve(ret);
    }

    // --------------------------------------------------------- settings screens

    @PluginMethod
    public void openWifiSettings(PluginCall call) {
        // Android 10+ no longer lets apps switch Wi-Fi; the system panel is the supported way.
        String action = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? Settings.Panel.ACTION_WIFI : Settings.ACTION_WIFI_SETTINGS;
        open(call, action);
    }

    @PluginMethod
    public void openBluetoothSettings(PluginCall call) {
        open(call, Settings.ACTION_BLUETOOTH_SETTINGS);
    }

    @PluginMethod
    public void openLocationSettings(PluginCall call) {
        open(call, Settings.ACTION_LOCATION_SOURCE_SETTINGS);
    }

    private void open(PluginCall call, String action) {
        try {
            Intent intent = new Intent(action);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open settings: " + e.getMessage(), "UNAVAILABLE");
        }
    }

    // ------------------------------------------------------- turn Bluetooth on

    @PluginMethod
    public void requestBluetoothEnable(PluginCall call) {
        BluetoothAdapter ad = adapter();
        if (ad == null) {
            call.reject("This device has no Bluetooth.", "UNAVAILABLE");
            return;
        }
        if (ad.isEnabled()) {
            resolveEnabled(call, true);
            return;
        }
        if (MODERN_BLUETOOTH && getPermissionState("bluetooth") != PermissionState.GRANTED) {
            requestPermissionForAlias("bluetooth", call, "enablePermissionResult");
            return;
        }
        launchEnable(call);
    }

    @PermissionCallback
    private void enablePermissionResult(PluginCall call) {
        if (getPermissionState("bluetooth") == PermissionState.GRANTED) launchEnable(call);
        else call.reject("Bluetooth permission was denied.", "PERMISSION_DENIED");
    }

    @SuppressLint("MissingPermission")
    private void launchEnable(PluginCall call) {
        // Shows the system "Allow this app to turn on Bluetooth?" dialog.
        startActivityForResult(call, new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), "enableResult");
    }

    @ActivityCallback
    private void enableResult(PluginCall call, ActivityResult result) {
        BluetoothAdapter ad = adapter();
        resolveEnabled(call, ad != null && ad.isEnabled());
    }

    private void resolveEnabled(PluginCall call, boolean enabled) {
        JSObject r = new JSObject();
        r.put("enabled", enabled);
        call.resolve(r);
    }

    // ----------------------------------------------------- scan nearby devices

    private String scanAlias() {
        return MODERN_BLUETOOTH ? "bluetooth" : "location";
    }

    @PluginMethod
    public void scanBluetooth(PluginCall call) {
        BluetoothAdapter ad = adapter();
        if (ad == null) {
            call.reject("This device has no Bluetooth.", "UNAVAILABLE");
            return;
        }
        if (!ad.isEnabled()) {
            call.reject("Bluetooth is off. Turn it on first.", "BLUETOOTH_OFF");
            return;
        }
        if (getPermissionState(scanAlias()) != PermissionState.GRANTED) {
            requestPermissionForAlias(scanAlias(), call, "scanPermissionResult");
            return;
        }
        scan(call);
    }

    @PermissionCallback
    private void scanPermissionResult(PluginCall call) {
        if (getPermissionState(scanAlias()) == PermissionState.GRANTED) scan(call);
        else call.reject("Permission to scan for nearby devices was denied.", "PERMISSION_DENIED");
    }

    @SuppressLint("MissingPermission")
    private void scan(PluginCall call) {
        BluetoothAdapter ad = adapter();
        BluetoothLeScanner scanner = ad != null ? ad.getBluetoothLeScanner() : null;
        if (scanner == null) {
            call.reject("Bluetooth scanning is not available right now.", "UNAVAILABLE");
            return;
        }
        int seconds = Math.max(2, Math.min(call.getInt("seconds", 8), 30));
        Map<String, JSObject> found = new LinkedHashMap<>();
        AtomicBoolean done = new AtomicBoolean(false);
        Handler main = new Handler(Looper.getMainLooper());

        ScanCallback callback = new ScanCallback() {
            @Override
            public void onScanResult(int callbackType, ScanResult result) {
                String address = result.getDevice().getAddress();
                String name = result.getScanRecord() != null ? result.getScanRecord().getDeviceName() : null;
                if (name == null) {
                    try {
                        name = result.getDevice().getName();
                    } catch (SecurityException ignored) {
                        // Name needs BLUETOOTH_CONNECT; the address is still useful.
                    }
                }
                JSObject d = new JSObject();
                d.put("name", name);
                d.put("address", address);
                d.put("rssi", result.getRssi());
                synchronized (found) {
                    found.put(address, d);
                }
            }

            @Override
            public void onScanFailed(int errorCode) {
                if (done.compareAndSet(false, true)) call.reject("Bluetooth scan failed (code " + errorCode + ").", "SCAN_FAILED");
            }
        };

        scanner.startScan(callback);
        main.postDelayed(() -> {
            try {
                scanner.stopScan(callback);
            } catch (Exception ignored) {
                // Bluetooth may have been switched off mid-scan.
            }
            if (!done.compareAndSet(false, true)) return;
            JSArray list = new JSArray();
            synchronized (found) {
                for (JSObject d : found.values()) list.put(d);
            }
            JSObject ret = new JSObject();
            ret.put("devices", list);
            call.resolve(ret);
        }, seconds * 1000L);
    }
}
