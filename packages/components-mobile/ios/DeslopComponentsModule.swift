import ExpoModulesCore
import ExpoUI
import SwiftUI
import UIKit

public class DeslopComponentsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DeslopComponents")

    // Metadata only: iOS asks for paste permission when the user chooses to read the content.
    Function("clipboardChangeCount") { () -> Int in
      UIPasteboard.general.changeCount
    }

    // Never unregistered: after an update reload the old module is destroyed after the new one registered, and would remove it.
    OnCreate {
      ViewModifierRegistry.register("bottomBarSearch") { params, appContext, _ in
        try BottomBarSearch(from: params, appContext: appContext)
      }
    }
  }
}

// The search field between the bottom bar's buttons, where iOS 26 would otherwise fold it into a button of its own.
struct BottomBarSearch: ViewModifier, Record {
  func body(content: Content) -> some View {
    content.toolbar {
      ToolbarSpacer(.fixed, placement: .bottomBar)
      DefaultToolbarItem(kind: .search, placement: .bottomBar)
      ToolbarSpacer(.fixed, placement: .bottomBar)
    }
  }
}
