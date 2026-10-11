import ExpoModulesCore
import UIKit

// Asks the clipboard what it holds without reading it, so iOS shows no "pasted from" banner until the user chooses to
// save. The change count rises with every copy on the iPhone, which tells a new item from one already handled.
public class StashPasteboardModule: Module {
  public func definition() -> ModuleDefinition {
    Name("StashPasteboard")

    Function("changeCount") { () -> Int in
      UIPasteboard.general.changeCount
    }

    // A copied link, either as a URL item or as text that looks like a web address.
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

    Function("hasImage") { () -> Bool in
      UIPasteboard.general.hasImages
    }
  }
}
