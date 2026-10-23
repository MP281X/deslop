import ExpoModulesCore
import ExpoUI

public class OpmNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OpmNative")

    OnCreate {
      Diagnostics.shared.start()
    }

    Function("takeDiagnostics") {
      Diagnostics.take()
    }

    ExpoUIView(PageStripView.self)
    ExpoUIView(CoverView.self)
    ExpoUIView(TitleView.self)
    ExpoUIView(ChapterProgressView.self)
  }
}
