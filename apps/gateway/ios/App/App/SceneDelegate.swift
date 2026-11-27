import UIKit
import Capacitor

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = deslopNavigation(GatewayViewController())
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

private final class GatewayViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(DeslopNativePlugin())
        bridge?.registerPluginInstance(GatewayPlugin())
    }
}

@MainActor
@objc(GatewayPlugin)
private final class GatewayPlugin: CAPPlugin, CAPBridgedPlugin {
    nonisolated let identifier = "GatewayPlugin"
    nonisolated let jsName = "Gateway"
    nonisolated let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "copy", returnType: CAPPluginReturnPromise)
    ]

    @objc nonisolated func copy(_ call: CAPPluginCall) {
        Task { @MainActor in
            guard let url = call.getString("url") else {
                call.reject("The MCP URL is unavailable.")
                return
            }
            UIPasteboard.general.string = url
            call.resolve()
        }
    }
}
