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

    // The copied image as a JPEG file, so its bytes never cross into JavaScript as base64: its size, and the file only when it fits in `maxBytes`; nil when the pasteboard holds no image.
    AsyncFunction("clipboardImage") { (maxBytes: Int) throws -> [String: Any]? in
      guard let image = UIPasteboard.general.image, let jpeg = image.jpegData(compressionQuality: 0.85) else {
        return nil
      }
      if jpeg.count > maxBytes {
        return ["bytes": jpeg.count]
      }
      let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).jpg")
      try jpeg.write(to: url, options: .atomic)
      return ["bytes": jpeg.count, "uri": url.absoluteString]
    }

    // Foundation writes beside the file and renames over it, which replaces it in one step; expo-file-system's overwriting move deletes the old file first.
    Function("writeAtomically") { (url: URL, text: String) throws in
      try Data(text.utf8).write(to: url, options: .atomic)
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
