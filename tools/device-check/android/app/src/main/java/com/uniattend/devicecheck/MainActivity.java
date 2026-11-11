package com.uniattend.devicecheck;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugin (not from npm), so it is registered by hand before the bridge starts.
        registerPlugin(DeviceStatusPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
