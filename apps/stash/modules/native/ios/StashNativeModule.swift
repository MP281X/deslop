import ExpoModulesCore
import ExpoUI
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

    // The App Group folder of queued shares and their answers, which the app handles once it opens.
    Function("sharedUploads") { sharedUploads()?.absoluteString }

    ExpoUIView(Logo.self)
  }
}
