import ExpoModulesCore
import Security
import UIKit

public class StashNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("StashNative")

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

    Function("getSession") { () throws -> String in
      var query = try self.keychainQuery()
      query[kSecReturnData as String] = true
      query[kSecMatchLimit as String] = kSecMatchLimitOne
      var value: CFTypeRef?
      let status = SecItemCopyMatching(query as CFDictionary, &value)
      if status == errSecItemNotFound { return "" }
      guard status == errSecSuccess, let data = value as? Data,
        let text = String(data: data, encoding: .utf8)
      else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
      return text
    }

    Function("setSession") { (value: String) throws in
      var query = try self.keychainQuery()
      let data = Data(value.utf8)
      let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
      if status == errSecItemNotFound {
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let added = SecItemAdd(query as CFDictionary, nil)
        guard added == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(added)) }
      } else if status != errSecSuccess {
        throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
      }
    }

    Function("clearSession") { () throws in
      let status = SecItemDelete(try self.keychainQuery() as CFDictionary)
      guard status == errSecSuccess || status == errSecItemNotFound
      else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
    }

    AsyncFunction("lockSession") { () async throws -> [String: Int] in
      guard let identifier = Bundle.main.bundleIdentifier else { throw CocoaError(.featureUnsupported) }
      // The JS continuation must write credentials before iOS suspends the containing app.
      let task = await MainActor.run {
        UIApplication.shared.beginBackgroundTask(withName: "Stash authentication")
      }
      guard task != .invalid else { throw CocoaError(.userCancelled) }
      do {
        let descriptor = try await SessionLock.acquire(group: "group.\(identifier)")
        return ["backgroundTask": task.rawValue, "descriptor": Int(descriptor)]
      } catch {
        await MainActor.run { UIApplication.shared.endBackgroundTask(task) }
        throw error
      }
    }

    AsyncFunction("unlockSession") { (lock: [String: Int]) async throws in
      guard let descriptor = lock["descriptor"], let task = lock["backgroundTask"] else {
        throw CocoaError(.coderValueNotFound)
      }
      SessionLock.release(Int32(descriptor))
      await MainActor.run {
        UIApplication.shared.endBackgroundTask(UIBackgroundTaskIdentifier(rawValue: task))
      }
    }

  }

  private func keychainQuery() throws -> [String: Any] {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "DeslopKeychainGroup") as? String
    else { throw CocoaError(.featureUnsupported) }
    return [kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "deslop.auth", kSecAttrAccount as String: "stash",
      kSecAttrAccessGroup as String: group]
  }
}
