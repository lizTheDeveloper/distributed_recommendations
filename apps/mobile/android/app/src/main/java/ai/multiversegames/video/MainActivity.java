package ai.multiversegames.video;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.TextView;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;

/**
 * The Capacitor activity, with two additions (see apps/mobile/README.md):
 *
 * 1. Share sheet. "Share to Multiverse Video" sends ACTION_SEND text/plain. It is rewritten here into
 *    an ACTION_VIEW intent for {custom_url_scheme}://share?text=..., which @capacitor/app delivers
 *    to the page as appUrlOpen (warm start) or getLaunchUrl (cold start). The web side
 *    (bridge/links.ts) only pattern-matches the text; nothing is fetched here.
 *
 * 2. WebView gate. The page CSP forbids inline scripts, and Capacitor only avoids inline injection
 *    when the WebView supports DOCUMENT_START_SCRIPT. Without WEB_MESSAGE_LISTENER, Capacitor
 *    falls back to addJavascriptInterface, which exposes the native bridge to every frame,
 *    including third-party PeerTube embeds. On such WebViews we refuse to run and ask the user to
 *    update Android System WebView.
 */
public class MainActivity extends BridgeActivity {

    private static final int MAX_SHARED_TEXT = 4096;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        setIntent(rewriteShare(getIntent()));
        super.onCreate(savedInstanceState);
        if (!webViewIsSupported()) {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().stopLoading();
                getBridge().getWebView().loadUrl("about:blank");
            }
            TextView msg = new TextView(this);
            msg.setText(R.string.webview_too_old);
            msg.setGravity(Gravity.CENTER);
            msg.setPadding(48, 48, 48, 48);
            setContentView(msg);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        Intent rewritten = rewriteShare(intent);
        setIntent(rewritten);
        super.onNewIntent(rewritten);
    }

    static boolean webViewIsSupported() {
        return WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
            && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER);
    }

    private Intent rewriteShare(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return intent;
        String type = intent.getType();
        if (type == null || !type.startsWith("text/")) return intent;
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (text == null) return intent;
        String s = text.toString();
        if (s.length() > MAX_SHARED_TEXT) s = s.substring(0, MAX_SHARED_TEXT);
        Uri uri = new Uri.Builder()
            .scheme(getString(R.string.custom_url_scheme))
            .authority("share")
            .appendQueryParameter("text", s)
            .build();
        Intent view = new Intent(Intent.ACTION_VIEW, uri);
        view.setPackage(getPackageName());
        return view;
    }
}
