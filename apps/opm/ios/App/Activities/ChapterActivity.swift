import ActivityKit
import SwiftUI
import WidgetKit

@main
struct ChapterActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ChapterActivityAttributes.self) { context in
            details(context.state)
                .padding(16)
                .activityBackgroundTint(.black)
                .widgetURL(context.attributes.url)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.bottom) {
                    details(context.state)
                        .padding(.horizontal, 12)
                }
            } compactLeading: {
                Text("OPM").font(.caption.bold())
            } compactTrailing: {
                Text(context.state.number).font(.caption.bold().monospacedDigit())
            } minimal: {
                Text("OPM").font(.caption2.bold())
            }
            .widgetURL(context.attributes.url)
        }
    }

    private func details(_ state: ChapterActivityAttributes.ContentState) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                Text("OPM").font(.caption.bold())
                Text("\(state.name) \(state.number)")
                    .font(.headline)
                    .monospacedDigit()
                    .lineLimit(1)
            }
            Text("Out now · \(state.pages) pages")
                .font(.caption)
                .monospacedDigit()
                .foregroundStyle(.secondary)
            Text("Tap to read").font(.caption)
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
