import ExpoModulesCore
import ExpoUI
import Security
import UIKit

public class StashNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("StashNative")

    // The previous release kept the session under this Keychain item; deleting it stops its bearer outliving that release.
    OnCreate {
      guard let group = Bundle.main.object(forInfoDictionaryKey: "DeslopKeychainGroup") as? String else { return }
      SecItemDelete(
        [kSecClass as String: kSecClassGenericPassword,
          kSecAttrService as String: "deslop.auth", kSecAttrAccount as String: "stash",
          kSecAttrAccessGroup as String: group] as CFDictionary)
    }

    AsyncFunction("hasLink") { (promise: Promise) in
      let board = UIPasteboard.general
      if board.hasURLs {
        promise.resolve(true)
        return
      }
      board.detectPatterns(for: [\UIPasteboard.DetectedValues.probableWebURL]) { result in
        switch result {
        case .success(let patterns): promise.resolve(patterns.contains(\UIPasteboard.DetectedValues.probableWebURL))
        case .failure: promise.resolve(false)
        }
      }
    }

    ExpoUIView(Logo.self)
  }
}
