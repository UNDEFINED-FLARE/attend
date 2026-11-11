import { registerPlugin } from "@capacitor/core";

// Bridge to the small native module in
// android/app/src/main/java/com/uniattend/devicecheck/DeviceStatusPlugin.java.
// In the browser the same calls go to DeviceStatusWeb (deviceStatusWeb.ts).

export interface WifiStatus {
  supported: boolean;
  enabled: boolean | null;
  connected: boolean | null;
  ssid: string | null;
  note?: string;
}

export interface BluetoothStatus {
  supported: boolean;
  enabled: boolean | null;
  note?: string;
}

export interface LocationStatus {
  servicesEnabled: boolean | null;
  note?: string;
}

export interface DeviceStatusInfo {
  platform: "android" | "web";
  wifi: WifiStatus;
  bluetooth: BluetoothStatus;
  location: LocationStatus;
}

export interface NearbyDevice {
  name: string | null;
  address: string;
  rssi: number | null;
}

export interface DeviceStatusPlugin {
  getStatus(): Promise<DeviceStatusInfo>;
  openWifiSettings(): Promise<void>;
  openBluetoothSettings(): Promise<void>;
  openLocationSettings(): Promise<void>;
  requestBluetoothEnable(): Promise<{ enabled: boolean }>;
  scanBluetooth(options: { seconds: number }): Promise<{ devices: NearbyDevice[] }>;
}

export const DeviceStatus = registerPlugin<DeviceStatusPlugin>("DeviceStatus", {
  web: () => import("./deviceStatusWeb").then((m) => new m.DeviceStatusWeb()),
});
