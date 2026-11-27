import ActivityKit

// Trips' APNs start names this type; start, update and end all carry the same content state.
struct LiveActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var name: String
        var props: String?
    }

    var url: String?
}
