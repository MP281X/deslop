import ActivityKit
import SwiftUI
import WidgetKit

@main
struct JourneyActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: LiveActivityAttributes.self) { context in
            if let journey = Journey(context.state) {
                journey.banner
                    .activityBackgroundTint(Journey.background)
                    .widgetURL(context.attributes.url.flatMap(URL.init(string:)))
            }
        } dynamicIsland: { context in
            let journey = Journey(context.state)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    journey?.what(28).padding(.leading, 6)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    journey?.when(28).padding(.trailing, 6)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if let journey {
                        VStack(alignment: .leading, spacing: 8) {
                            journey.bar
                            journey.details
                        }
                        .padding(.horizontal, 12)
                        .padding(.top, 2)
                    }
                }
            } compactLeading: {
                journey?.location
            } compactTrailing: {
                journey?.ring
            } minimal: {
                journey?.ring
            }
            .widgetURL(context.attributes.url.flatMap(URL.init(string:)))
        }
    }
}

private struct Journey {
    static let background = Color(red: 9 / 255, green: 9 / 255, blue: 11 / 255)
    private let plain = Color(red: 250 / 255, green: 250 / 255, blue: 250 / 255)
    private let gray = Color(red: 159 / 255, green: 159 / 255, blue: 169 / 255)

    private let props: Props

    init?(_ state: LiveActivityAttributes.ContentState) {
        guard state.name == "JourneyActivity", let json = state.props else { return nil }
        // APNs' outer state carries a JSON string; its inner dates are Unix milliseconds.
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
        guard let props = try? decoder.decode(Props.self, from: Data(json.utf8)) else { return nil }
        self.props = props
    }

    var banner: some View {
        VStack(alignment: .leading, spacing: 11) {
            HStack(alignment: .bottom, spacing: 12) {
                what(34)
                Spacer()
                when(34)
            }
            bar
            details
        }
        .padding(16)
    }

    func what(_ size: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            label(props.label)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(props.value)
                    .font(.system(size: size, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(plain)
                    .opacity(props.pending ? 0.35 : 1)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .fixedSize(horizontal: false, vertical: true)
                if let was = props.was { struck(was, size: size / 2) }
            }
        }
        .layoutPriority(1)
    }

    func when(_ size: CGFloat) -> some View {
        VStack(alignment: .trailing, spacing: 1) {
            label(props.until).lineLimit(1)
            Group {
                if let deadline = props.deadline {
                    Text(timerInterval: min(.now, deadline)...deadline, countsDown: true)
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: size * 3.7, alignment: .trailing)
                } else {
                    Text(props.untilValue)
                }
            }
            .font(.system(size: size, weight: .medium))
            .monospacedDigit()
            .foregroundStyle(plain)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
        }
    }

    var bar: some View {
        HStack(spacing: 4) {
            ForEach(0..<4) { index in
                Group {
                    if index == props.segment {
                        ProgressView(timerInterval: interval(props.segmentSince, props.segmentUntil), countsDown: false) {
                            EmptyView()
                        } currentValueLabel: {
                            EmptyView()
                        }
                    } else {
                        ProgressView(value: index < props.segment ? 1.0 : 0.0)
                    }
                }
                .progressViewStyle(.linear)
                .tint(plain)
                .frame(maxWidth: .infinity)
            }
        }
    }

    var details: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(props.small)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(gray)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .layoutPriority(1)
                Spacer()
                HStack(spacing: 6) {
                    Text(props.note)
                        .font(.system(size: 13, weight: .medium))
                        .monospacedDigit()
                        .foregroundStyle(props.noteTone == .warn ? tint(.warn) : gray)
                        .lineLimit(1)
                    if let was = props.noteWas { struck(was, size: 13) }
                }
                .fixedSize()
            }
            if let problem = props.problem {
                HStack(spacing: 7) {
                    Image(systemName: "circle.fill").font(.system(size: 8))
                    Text(problem).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                }
                .foregroundStyle(tint(props.tone))
            }
        }
    }

    @ViewBuilder var location: some View {
        if let gate = props.gate {
            Text(gate)
                .font(.system(size: 14, weight: .bold))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .foregroundStyle(plain)
        } else {
            Image(systemName: props.symbol)
                .font(.system(size: 15))
                .foregroundStyle(plain)
        }
    }

    var ring: some View {
        Group {
            if let deadline = props.deadline {
                ProgressView(timerInterval: interval(props.since, deadline), countsDown: true) {
                    EmptyView()
                } currentValueLabel: {
                    EmptyView()
                }
            } else {
                ProgressView(value: 1.0)
            }
        }
        .progressViewStyle(.circular)
        .tint(tint(props.tone))
        .frame(width: 22, height: 22)
    }

    private func interval(_ start: Date, _ end: Date) -> ClosedRange<Date> {
        min(start, end)...end
    }

    private func label(_ text: String) -> some View {
        Text(text).font(.system(size: 13, weight: .semibold)).foregroundStyle(gray)
    }

    private func struck(_ text: String, size: CGFloat) -> some View {
        Text(text)
            .font(.system(size: size, weight: .medium))
            .monospacedDigit()
            .foregroundStyle(gray)
            .strikethrough()
    }

    private func tint(_ tone: Tone) -> Color {
        switch tone {
        case .bad: Color(red: 1, green: 100 / 255, blue: 103 / 255)
        case .warn: Color(red: 1, green: 158 / 255, blue: 59 / 255)
        case .good, .info, .plain: plain
        }
    }

    private enum Tone: String, Decodable {
        case bad, good, info, plain, warn
    }

    private struct Props: Decodable {
        let deadline: Date?
        let gate: String?
        let label: String
        let note: String
        let noteTone: Tone
        let noteWas: String?
        let pending: Bool
        let problem: String?
        let segment: Int
        let segmentSince: Date
        let segmentUntil: Date
        let since: Date
        let small: String
        let symbol: String
        let tone: Tone
        let until: String
        let untilValue: String
        let value: String
        let was: String?
    }
}
