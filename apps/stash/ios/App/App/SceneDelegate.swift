import Capacitor
import UIKit

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }
    let window = UIWindow(windowScene: windowScene)
    let controller = StashViewController()
    controller.pendingNote = connectionOptions.urlContexts.lazy.compactMap { self.noteID($0.url) }.first
    window.rootViewController = deslopNavigation(controller)
    window.makeKeyAndVisible()
    self.window = window
    SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      if let id = noteID(context.url) {
        let navigation = window?.rootViewController as? UINavigationController
        (navigation?.topViewController as? StashViewController)?.openNote(id)
      }
    }
    SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    SceneDelegateProxy.shared.scene(scene, continue: userActivity)
  }

  private func noteID(_ url: URL) -> UUID? {
    guard url.scheme == "stash", url.host == "note", url.pathComponents.count == 2 else { return nil }
    return UUID(uuidString: url.lastPathComponent)
  }
}

private final class StashViewController: CAPBridgeViewController {
  var pendingNote: UUID?

  override func capacitorDidLoad() {
    bridge?.registerPluginInstance(DeslopNativePlugin())
    bridge?.registerPluginInstance(StashNativePlugin())
    webView?.allowsBackForwardNavigationGestures = true
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    if let id = pendingNote {
      pendingNote = nil
      openNote(id)
    }
  }

  func openNote(_ id: UUID) {
    guard let origin = bridge?.config.appStartServerURL,
      var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false)
    else { return }
    parts.queryItems = [
      URLQueryItem(name: "note", value: id.uuidString.lowercased()),
      URLQueryItem(name: "pane", value: "detail"),
    ]
    if let url = parts.url { webView?.load(URLRequest(url: url)) }
  }
}
