import ExpoModulesCore
import ExpoUI

public class OpmNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OpmNative")

    ExpoUIView(PageStripView.self)
    ExpoUIView(CoverView.self)
  }
}
