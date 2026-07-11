import SwiftUI
import UniformTypeIdentifiers

struct ContentView: View {
    @EnvironmentObject private var store: CGMSStore
    @State private var showingImporter = false

    var body: some View {
        NavigationSplitView {
            List(selection: $store.route) {
                ForEach(AGPSection.allCases) { section in
                    Label(section.title, systemImage: icon(for: section))
                        .tag(section)
                }
            }
            .navigationTitle("CGMS AGP")
        } detail: {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    header
                    switch store.route {
                    case .importData:
                        importSection
                    case .summary:
                        summarySection
                    case .diet:
                        listPanel(title: "飲食調整關鍵點", items: store.analysis.dietKeyPoints, tint: .green)
                    case .treatment:
                        listPanel(title: "治療建議", items: store.analysis.treatmentSuggestions, tint: .blue)
                    }
                    treatmentPanel
                    reportPanel
                }
                .padding()
            }
            .navigationTitle(store.route.title)
        }
        .fileImporter(isPresented: $showingImporter, allowedContentTypes: [.commaSeparatedText, .plainText, .data]) { result in
            if case let .success(url) = result {
                store.importCSV(url: url)
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("CGMS / AGP 判讀")
                .font(.largeTitle.bold())
            Text("LibreView CSV 本機解析，產生 TIR/TBR/TAR、AGP 型態、飲食重點與治療建議。")
                .foregroundStyle(.secondary)
            Text("手機限制：iOS 不允許 app 未經使用者授權直接讀取 Libre App 或 Downloads；請使用 Files picker 或 Share Sheet 匯入 CSV。")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }

    private var importSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            Button {
                showingImporter = true
            } label: {
                Label("選擇 LibreView CSV", systemImage: "square.and.arrow.down")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            if let error = store.importError {
                Text(error)
                    .foregroundStyle(.red)
            }
            Text("已載入 \(store.readings.count) 筆 readings；active days \(store.metrics.activeDays)，capture \(store.metrics.capturePercent, specifier: "%.1f")%。")
                .foregroundStyle(.secondary)
        }
        .panel()
    }

    private var summarySection: some View {
        VStack(alignment: .leading, spacing: 16) {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 2), spacing: 12) {
                metricCard("TIR", "\(store.metrics.tir70to180, specifier: "%.1f")%", note: "70-180 mg/dL", tint: .green)
                metricCard("TBR", "\(store.metrics.tbrBelow70, specifier: "%.1f")%", note: "<70 mg/dL", tint: .orange)
                metricCard("TAR", "\(store.metrics.tarAbove180, specifier: "%.1f")%", note: ">180 mg/dL", tint: .yellow)
                metricCard("CV", "\(store.metrics.cv, specifier: "%.1f")%", note: "變異係數", tint: .teal)
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("判讀優先順序")
                    .font(.headline)
                Text(store.analysis.priority)
                    .font(.title3.bold())
            }
            listPanel(title: "安全警訊", items: store.analysis.safetyAlerts.isEmpty ? ["未偵測明顯低血糖或高變異警訊。"] : store.analysis.safetyAlerts, tint: .red)
            listPanel(title: "可能原因", items: store.analysis.possibleCauses, tint: .orange)
            AGPChart(summary: store.metrics.hourlySummary)
        }
    }

    private var treatmentPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("治療與背景")
                .font(.headline)
            Picker("糖尿病類型", selection: $store.profile.diabetesType) {
                Text("type 2 diabetes").tag("type 2 diabetes")
                Text("type 1 diabetes").tag("type 1 diabetes")
                Text("prediabetes").tag("prediabetes")
                Text("gestational diabetes").tag("gestational diabetes")
            }
            TextField("CKD / 透析背景，例如 CKD G4、HD、PD、eGFR 28", text: $store.profile.kidneyContext)
                .textFieldStyle(.roundedBorder)
            ForEach(TherapyOption.allCases) { option in
                Toggle(option.rawValue, isOn: Binding(
                    get: { store.profile.therapies.contains(option) },
                    set: { enabled in
                        if enabled { store.profile.therapies.insert(option) } else { store.profile.therapies.remove(option) }
                        store.reanalyze()
                    }
                ))
            }
            TextField("補充用藥與低血糖處置", text: $store.profile.therapyNotes, axis: .vertical)
                .textFieldStyle(.roundedBorder)
            Button("重新分析") {
                store.reanalyze()
            }
            .buttonStyle(.bordered)
        }
        .panel()
    }

    private var reportPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("臨床報告")
                .font(.headline)
            Text(store.analysis.reportText)
                .font(.callout.monospaced())
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .panel()
    }

    private func metricCard(_ title: String, _ value: String, note: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.title.bold())
            Text(note)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
    }

    private func listPanel(title: String, items: [String], tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)
            ForEach(items.isEmpty ? ["尚無資料"] : items, id: \.self) { item in
                Label(item, systemImage: "checkmark.circle")
                    .labelStyle(.titleAndIcon)
                    .foregroundStyle(.primary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(tint.opacity(0.10), in: RoundedRectangle(cornerRadius: 12))
    }

    private func icon(for section: AGPSection) -> String {
        switch section {
        case .importData: "square.and.arrow.down"
        case .summary: "chart.xyaxis.line"
        case .diet: "fork.knife"
        case .treatment: "cross.case"
        }
    }
}

struct AGPChart: View {
    let summary: [HourlySummary]

    var body: some View {
        VStack(alignment: .leading) {
            Text("AGP Percentile")
                .font(.headline)
            ChartCanvas(summary: summary)
                .frame(height: 220)
        }
        .panel()
    }
}

struct ChartCanvas: View {
    let summary: [HourlySummary]

    var body: some View {
        GeometryReader { proxy in
            let values = summary.filter { $0.median != nil }
            Canvas { context, size in
                let rect = CGRect(x: 28, y: 12, width: size.width - 42, height: size.height - 34)
                let y: (Double) -> Double = { glucose in
                    rect.maxY - ((glucose - 40) / 280) * rect.height
                }
                context.fill(Path(CGRect(x: rect.minX, y: y(180), width: rect.width, height: y(70) - y(180))), with: .color(.green.opacity(0.12)))
                guard values.count > 1 else { return }
                var median = Path()
                for (index, hour) in values.enumerated() {
                    let x = rect.minX + CGFloat(hour.hour) / 23 * rect.width
                    let point = CGPoint(x: x, y: y(hour.median ?? 0))
                    index == 0 ? median.move(to: point) : median.addLine(to: point)
                }
                context.stroke(median, with: .color(.teal), lineWidth: 3)
            }
            .overlay(alignment: .bottomLeading) {
                Text("0        6        12        18        23 hr")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .padding(.leading, 28)
            }
        }
    }
}

private extension View {
    func panel() -> some View {
        self.padding()
            .background(.background, in: RoundedRectangle(cornerRadius: 12))
            .shadow(color: .black.opacity(0.06), radius: 10, y: 4)
    }
}
