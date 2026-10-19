import UIKit
import WebKit
import Capacitor

/// The app's root view controller (set in Main.storyboard instead of CAPBridgeViewController).
///
/// Why: the feed loads cross-origin PeerTube embeds from arbitrary instances. As defense in
/// depth, only the app's own main frame may talk to the native bridge.
///
/// The filter below forwards a bridge message only when it comes from the main frame of the app's
/// own origin (capacitor://localhost). Everything else is dropped. The PSI frame (sandboxed,
/// opaque origin) never needs the bridge.
///
/// WebView media settings are Capacitor's defaults, restated here so they don't silently change:
/// inline playback (PeerTube embeds play in the feed, not fullscreen) and no user-gesture
/// requirement (Reels autoplays muted; the embed URL carries autoplay=1&muted=1).
class MainViewController: CAPBridgeViewController {

    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let config = super.webViewConfiguration(for: instanceConfiguration)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.allowsAirPlayForMediaPlayback = true
        config.allowsPictureInPictureMediaPlayback = true
        return config
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        guard let handler = webView?.navigationDelegate as? WebViewDelegationHandler,
              let serverURL = bridge?.config.serverURL else {
            fatalError("Capacitor bridge not ready; refusing to run without the frame filter")
        }
        let controller = handler.contentController
        controller.removeScriptMessageHandler(forName: "bridge")
        controller.add(MainFrameOnlyMessageHandler(inner: handler, allowedURL: serverURL), name: "bridge")
    }
}

/// Forwards script messages only from the main frame of the app origin.
final class MainFrameOnlyMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var inner: WKScriptMessageHandler?
    private let scheme: String
    private let host: String
    private let port: Int

    init(inner: WKScriptMessageHandler, allowedURL: URL) {
        self.inner = inner
        self.scheme = allowedURL.scheme?.lowercased() ?? "capacitor"
        self.host = allowedURL.host?.lowercased() ?? "localhost"
        self.port = allowedURL.port ?? 0
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame,
              origin.protocol.lowercased() == scheme,
              origin.host.lowercased() == host,
              origin.port == port else {
            CAPLog.print("Dropped a native bridge message from a non-app frame: \(origin.protocol)://\(origin.host)")
            return
        }
        inner?.userContentController(userContentController, didReceive: message)
    }
}
