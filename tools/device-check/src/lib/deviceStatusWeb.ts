import { WebPlugin } from "@capacitor/core";
import type { DeviceStatusInfo, DeviceStatusPlugin, NearbyDevice } from "./deviceStatus";

// Browser version of the native module. Browsers deliberately hide Wi-Fi and
// Bluetooth radio state, so this reports what the web platform allows and
// says plainly what only the Android app can do.

type NetInfo = { type?: string };
type WebBluetooth = {
  getAvailability?: () => Promise<boolean>;
  requestDevice: (options: { acceptAllDevices: boolean }) => Promise<{ id: string; name?: string }>;
};

function webBluetooth(): WebBluetooth | undefined {
  return (navigator as Navigator & { bluetooth?: WebBluetooth }).bluetooth;
}

export class DeviceStatusWeb extends WebPlugin implements DeviceStatusPlugin {
  async getStatus(): Promise<DeviceStatusInfo> {
    const conn = (navigator as Navigator & { connection?: NetInfo }).connection;
    const bt = webBluetooth();
    let available: boolean | null = null;
    if (bt?.getAvailability) {
      try {
        available = await bt.getAvailability();
      } catch {
        available = null;
      }
    }
    return {
      platform: "web",
      wifi: {
        supported: false,
        enabled: null,
        connected: conn?.type ? conn.type === "wifi" : null,
        ssid: null,
        note: "Browsers can't read Wi-Fi details. The Android app can.",
      },
      bluetooth: {
        supported: !!bt,
        enabled: available,
        note: bt
          ? "Web Bluetooth lets you pick one nearby device. Turning Bluetooth on needs the Android app."
          : "This browser has no Web Bluetooth. Try Chrome or Edge on Android or desktop.",
      },
      location: {
        servicesEnabled: null,
        note: "Browsers can't see whether location services are switched on.",
      },
    };
  }

  async openWifiSettings(): Promise<void> {
    throw this.unavailable("Only the Android app can open Wi-Fi settings.");
  }

  async openBluetoothSettings(): Promise<void> {
    throw this.unavailable("Only the Android app can open Bluetooth settings.");
  }

  async openLocationSettings(): Promise<void> {
    throw this.unavailable("Only the Android app can open location settings.");
  }

  async requestBluetoothEnable(): Promise<{ enabled: boolean }> {
    throw this.unavailable("Only the Android app can turn Bluetooth on.");
  }

  async scanBluetooth(): Promise<{ devices: NearbyDevice[] }> {
    const bt = webBluetooth();
    if (!bt) throw this.unavailable("This browser has no Web Bluetooth.");
    const device = await bt.requestDevice({ acceptAllDevices: true });
    return { devices: [{ name: device.name ?? null, address: device.id, rssi: null }] };
  }
}
