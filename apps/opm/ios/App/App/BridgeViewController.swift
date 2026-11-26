import Capacitor
import Foundation

class BridgeViewController: CAPBridgeViewController {
    private var chapters: OpmNativePlugin?
    private var pendingChapter: URL?

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(DeslopNativePlugin())
        let plugin = OpmNativePlugin()
        bridge?.registerPluginInstance(plugin)
        chapters = plugin
        if let pendingChapter {
            plugin.openChapter(pendingChapter)
            self.pendingChapter = nil
        }
    }

    func openChapter(_ url: URL) {
        if let chapters {
            chapters.openChapter(url)
        } else {
            pendingChapter = url
        }
    }
}
