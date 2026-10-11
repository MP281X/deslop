import ExpoModulesCore
import ExpoUI
import SwiftUI
import UIKit

public class StashNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("StashNative")

    OnCreate {
      ViewModifierRegistry.register("bottomBarSearch") { params, appContext, _ in
        try BottomBarSearch(from: params, appContext: appContext)
      }
    }

    OnDestroy {
      ViewModifierRegistry.unregister("bottomBarSearch")
    }

    // Asking what the clipboard holds reads nothing, so iOS shows no paste banner.
    Function("changeCount") { () -> Int in
      UIPasteboard.general.changeCount
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

  }
}

struct BottomBarSearch: ViewModifier, Record {
  @ViewBuilder
  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) {
      content.toolbar {
        ToolbarSpacer(.fixed, placement: .bottomBar)
        DefaultToolbarItem(kind: .search, placement: .bottomBar)
        ToolbarSpacer(.fixed, placement: .bottomBar)
      }
    } else {
      content
    }
  }
}
