import ExpoModulesCore
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

  }
}
