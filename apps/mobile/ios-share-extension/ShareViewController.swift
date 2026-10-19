import UIKit
import UniformTypeIdentifiers

/// "Share to Meme Video" for iOS. Add as a Share Extension target in Xcode (see
/// apps/mobile/README.md, "iOS share extension"). It accepts one URL or plain text, writes it
/// to the App Group that @capgo/capacitor-share-target reads (key "share-target-data"), and
/// closes. The plugin delivers it to the web app the next time the app becomes active.
///
/// It does not open the host app itself: the usual trick (walking the responder chain to call
/// openURL) is private-API-adjacent and an App Review risk. Nothing is fetched here.
final class ShareViewController: UIViewController {
    /// Must match plugins.CapacitorShareTarget.appGroupId in capacitor.config.ts
    /// ("group." + the app id in brand.json) and both targets' App Groups entitlement.
    private let appGroupId = "group.school.multiverse.memevideo"
    private let maxLength = 4096

    override func viewDidLoad() {
        super.viewDidLoad()
        Task { await handle() }
    }

    private func handle() async {
        let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
        var texts: [String] = []
        for item in items {
            for provider in item.attachments ?? [] {
                if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
                   let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL,
                   url.scheme == "https" || url.scheme == "nostr" {
                    texts.append(String(url.absoluteString.prefix(maxLength)))
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                          let text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
                    texts.append(String(text.prefix(maxLength)))
                }
                if texts.count >= 4 { break }
            }
        }
        if !texts.isEmpty, let defaults = UserDefaults(suiteName: appGroupId) {
            let title = items.first?.attributedContentText?.string ?? ""
            defaults.set(["title": String(title.prefix(200)), "texts": texts, "files": []], forKey: "share-target-data")
        }
        await MainActor.run {
            let done = UIAlertController(title: nil, message: texts.isEmpty ? "Nothing to share" : "Saved. Open Meme Video to see it.", preferredStyle: .alert)
            present(done, animated: true)
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
                self?.extensionContext?.completeRequest(returningItems: nil)
            }
        }
    }
}
