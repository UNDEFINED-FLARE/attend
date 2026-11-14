package za.uniattend.app;

import android.webkit.CookieManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // Android writes WebView cookies to disk only every so often. Save them as soon as the
    // app leaves the screen, so a sign-in survives the app being closed or killed.
    @Override
    public void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    public void onStop() {
        super.onStop();
        CookieManager.getInstance().flush();
    }
}
