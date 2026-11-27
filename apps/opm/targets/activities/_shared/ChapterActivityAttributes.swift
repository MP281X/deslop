import ActivityKit
import Foundation

struct ChapterActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        let name: String
        let number: String
        let pages: Int
    }

    let url: URL
}
