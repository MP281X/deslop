import ActivityKit
import Foundation

struct SaveActivityAttributes: ActivityAttributes {
  struct ContentState: Codable, Hashable {
    enum Status: String, Codable {
      case organizing, ready, failed
    }

    var elapsed: Double?
    var noteId: UUID
    var source: String
    var status: Status
    var summary: String
    var title: String
    var total: Double?
  }

  var captureId: UUID
}
