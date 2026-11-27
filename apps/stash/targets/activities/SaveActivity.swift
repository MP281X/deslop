import ActivityKit
import SwiftUI
import WidgetKit

@main
struct SaveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: SaveActivityAttributes.self) { context in
      SaveProgress(state: context.state).details
        .padding(15)
        .activityBackgroundTint(.black)
        .widgetURL(noteURL(context.state.noteId))
    } dynamicIsland: { context in
      let progress = SaveProgress(state: context.state)
      return DynamicIsland {
        DynamicIslandExpandedRegion(.bottom) {
          progress.details.padding(.horizontal, 8)
        }
      } compactLeading: {
        Text("S").font(.headline)
      } compactTrailing: {
        progress.trailing
      } minimal: {
        Text("S").font(.headline)
      }
      .widgetURL(noteURL(context.state.noteId))
    }
  }

  private func noteURL(_ id: UUID) -> URL? {
    URL(string: "stash:///?note=\(id.uuidString.lowercased())&pane=detail")
  }
}

private struct SaveProgress {
  let state: SaveActivityAttributes.ContentState

  var details: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: 6) {
        Text("S").fontWeight(.bold)
        Text(heading).fontWeight(.semibold).lineLimit(1)
      }
      .font(.subheadline)
      if !detail.isEmpty {
        Text(detail).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
      }
      let action = state.status == .organizing ? state.source : "Open in Stash"
      if !action.isEmpty {
        Text(action).font(.footnote).lineLimit(1)
      }
      if state.status == .organizing, let elapsed = state.elapsed, let total = state.total, total > 0 {
        ProgressView(value: min(elapsed, total), total: total)
          .tint(.white)
          .accessibilityLabel("Transcription progress")
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private var heading: String {
    switch state.status {
    case .organizing: "Saving “\(state.title)”"
    case .ready: "Saved “\(state.title)”"
    case .failed: "Couldn’t read “\(state.title)”"
    }
  }

  private var detail: String {
    if state.status != .organizing { return state.summary }
    if let elapsed = state.elapsed, let total = state.total {
      if elapsed < total { return "Transcribing \(clock(elapsed)) of \(clock(total))" }
      return "Summarizing"
    }
    return ""
  }

  @ViewBuilder var trailing: some View {
    switch state.status {
    case .organizing:
      if let elapsed = state.elapsed {
        Text(clock(elapsed)).font(.subheadline.weight(.semibold)).monospacedDigit()
      } else {
        Image(systemName: "arrow.down").accessibilityLabel("Saving")
      }
    case .ready:
      Image(systemName: "checkmark").accessibilityLabel("Saved")
    case .failed:
      Image(systemName: "exclamationmark").accessibilityLabel("Couldn’t read the note")
    }
  }

  private func clock(_ seconds: Double) -> String {
    let elapsed = Int(seconds)
    return String(format: "%d:%02d", elapsed / 60, elapsed % 60)
  }
}
