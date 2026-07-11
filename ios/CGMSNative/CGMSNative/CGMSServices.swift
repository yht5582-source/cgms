import Foundation

enum CGMSError: LocalizedError {
    case emptyCSV
    case missingColumns
    case noValidReadings

    var errorDescription: String? {
        switch self {
        case .emptyCSV: "CSV 內容不足，請從 LibreView 匯出 glucose CSV。"
        case .missingColumns: "無法辨識時間與 glucose mg/dL 欄位。"
        case .noValidReadings: "沒有可用的 CGMS readings，請確認 CSV 格式。"
        }
    }
}

enum LibreCSVParser {
    static func parse(_ csvText: String) throws -> [GlucoseReading] {
        let rows = parseRows(csvText)
        guard rows.count > 1 else { throw CGMSError.emptyCSV }

        guard let headerIndex = rows.firstIndex(where: { row in
            let headers = row.map(normalize)
            return findColumn(headers, candidates: ["timestamp", "時間", "date", "日期"]) != nil &&
                findColumn(headers, candidates: ["glucose", "葡萄糖", "血糖"]) != nil
        }) else {
            throw CGMSError.missingColumns
        }

        let headers = rows[headerIndex].map(normalize)
        guard let timeIndex = findColumn(headers, candidates: ["timestamp", "device timestamp", "時間", "date", "日期"]) else {
            throw CGMSError.missingColumns
        }
        let glucoseColumns = [
            findColumn(headers, candidates: ["historic glucose", "歷史", "sensor glucose", "glucose value"]),
            findColumn(headers, candidates: ["scan glucose", "掃描"]),
            findColumn(headers, candidates: ["glucose", "葡萄糖", "血糖"])
        ].compactMap { $0 }.uniqued()

        let readings = rows.dropFirst(headerIndex + 1).enumerated().compactMap { offset, row -> GlucoseReading? in
            guard row.indices.contains(timeIndex), let timestamp = parseDate(row[timeIndex]) else { return nil }
            let glucose = glucoseColumns.compactMap { column -> Double? in
                row.indices.contains(column) ? cleanGlucose(row[column]) : nil
            }.first
            guard let glucose else { return nil }
            return GlucoseReading(timestamp: timestamp, glucoseMgDl: glucose, sourceRow: headerIndex + offset + 2)
        }.sorted { $0.timestamp < $1.timestamp }

        guard !readings.isEmpty else { throw CGMSError.noValidReadings }
        return readings
    }

    private static func parseRows(_ text: String) -> [[String]] {
        var rows: [[String]] = []
        var row: [String] = []
        var field = ""
        var inQuotes = false
        var iterator = Array(text).makeIterator()

        while let char = iterator.next() {
            if char == "\"" {
                inQuotes.toggle()
            } else if char == "," && !inQuotes {
                row.append(field.trimmingCharacters(in: .whitespacesAndNewlines))
                field = ""
            } else if (char == "\n" || char == "\r") && !inQuotes {
                row.append(field.trimmingCharacters(in: .whitespacesAndNewlines))
                if row.contains(where: { !$0.isEmpty }) { rows.append(row) }
                row = []
                field = ""
            } else {
                field.append(char)
            }
        }

        row.append(field.trimmingCharacters(in: .whitespacesAndNewlines))
        if row.contains(where: { !$0.isEmpty }) { rows.append(row) }
        return rows
    }

    private static func normalize(_ value: String) -> String {
        value.lowercased().replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func findColumn(_ headers: [String], candidates: [String]) -> Int? {
        headers.firstIndex { header in candidates.contains { header.contains($0) } }
    }

    private static func cleanGlucose(_ raw: String) -> Double? {
        let pattern = #"-?\d+(\.\d+)?"#
        guard let range = raw.range(of: pattern, options: .regularExpression), let value = Double(raw[range]), value >= 20, value <= 600 else {
            return nil
        }
        return value
    }

    private static func parseDate(_ raw: String) -> Date? {
        let formats = [
            "yyyy-MM-dd HH:mm",
            "yyyy-MM-dd HH:mm:ss",
            "M/d/yyyy h:mm a",
            "M/d/yyyy H:mm",
            "dd/MM/yyyy HH:mm",
            "yyyy/MM/dd HH:mm"
        ]
        for format in formats {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.dateFormat = format
            if let date = formatter.date(from: raw.trimmingCharacters(in: .whitespacesAndNewlines)) {
                return date
            }
        }
        return ISO8601DateFormatter().date(from: raw)
    }
}

enum AGPCalculator {
    static func metrics(for readings: [GlucoseReading]) -> AGPMetrics {
        guard !readings.isEmpty else { return AGPMetrics(hourlySummary: emptyHours()) }
        let values = readings.map(\.glucoseMgDl)
        let average = values.average
        let days = Set(readings.map { Calendar.current.startOfDay(for: $0.timestamp) })
        let span = max(1, Calendar.current.dateComponents([.day], from: readings.first!.timestamp, to: readings.last!.timestamp).day ?? 1)
        let expected = Double(span + 1) * 96.0
        let byHour = Dictionary(grouping: readings) { Calendar.current.component(.hour, from: $0.timestamp) }

        return AGPMetrics(
            activeDays: days.count,
            capturePercent: min(100, (Double(readings.count) / expected) * 100).rounded1,
            totalReadings: readings.count,
            averageGlucose: average.rounded1,
            gmi: (3.31 + 0.02392 * average).rounded1,
            tir70to180: percent(values.filter { $0 >= 70 && $0 <= 180 }.count, values.count),
            tbrBelow70: percent(values.filter { $0 < 70 }.count, values.count),
            tbrBelow54: percent(values.filter { $0 < 54 }.count, values.count),
            tarAbove180: percent(values.filter { $0 > 180 }.count, values.count),
            tarAbove250: percent(values.filter { $0 > 250 }.count, values.count),
            cv: ((values.standardDeviation / average) * 100).rounded1,
            hourlySummary: (0..<24).map { hour in
                let hourValues = (byHour[hour] ?? []).map(\.glucoseMgDl)
                return HourlySummary(
                    hour: hour,
                    median: hourValues.percentile(0.5)?.rounded1,
                    p10: hourValues.percentile(0.1)?.rounded1,
                    p25: hourValues.percentile(0.25)?.rounded1,
                    p75: hourValues.percentile(0.75)?.rounded1,
                    p90: hourValues.percentile(0.9)?.rounded1
                )
            }
        )
    }

    static func patterns(readings: [GlucoseReading], profile: TreatmentProfile) -> PatternFlags {
        PatternFlags(
            nocturnalLow: window(readings, 0, 6).below70 >= 5,
            fastingLow: window(readings, 5, 8).below70 >= 5,
            fastingHigh: window(readings, 5, 8).average > 130,
            postBreakfastSpike: mealSpike(readings, hour(profile.breakfast, fallback: 7.5)),
            postLunchSpike: mealSpike(readings, hour(profile.lunch, fallback: 12)),
            postDinnerSpike: mealSpike(readings, hour(profile.dinner, fallback: 18)),
            lateEveningHyperglycemia: window(readings, 20, 24).above180 >= 30
        )
    }

    private static func mealSpike(_ readings: [GlucoseReading], _ mealHour: Double) -> Bool {
        let baseline = window(readings, mealHour - 1, mealHour + 0.25).average
        let postMeal = window(readings, mealHour + 1, mealHour + 3).average
        return postMeal >= 180 || postMeal - baseline >= 60
    }

    private static func window(_ readings: [GlucoseReading], _ start: Double, _ end: Double) -> (average: Double, below70: Double, above180: Double) {
        let values = readings.filter { reading in
            let comps = Calendar.current.dateComponents([.hour, .minute], from: reading.timestamp)
            let hour = Double(comps.hour ?? 0) + Double(comps.minute ?? 0) / 60
            return start <= end ? hour >= start && hour < end : hour >= start || hour < end
        }.map(\.glucoseMgDl)
        guard !values.isEmpty else { return (0, 0, 0) }
        return (values.average.rounded1, percent(values.filter { $0 < 70 }.count, values.count), percent(values.filter { $0 > 180 }.count, values.count))
    }

    private static func hour(_ components: DateComponents, fallback: Double) -> Double {
        guard let hour = components.hour else { return fallback }
        return Double(hour) + Double(components.minute ?? 0) / 60
    }

    private static func emptyHours() -> [HourlySummary] {
        (0..<24).map { HourlySummary(hour: $0, median: nil, p10: nil, p25: nil, p75: nil, p90: nil) }
    }
}

enum AGPAnalyzer {
    static func analyze(metrics: AGPMetrics, patterns: PatternFlags, profile: TreatmentProfile) -> AGPAnalysis {
        var analysis = AGPAnalysis()
        var reasons: [String] = []
        if metrics.activeDays < 14 { reasons.append("建議至少 14 天資料，才能可靠判讀週間與週末差異") }
        if metrics.capturePercent < 70 { reasons.append("CGM active time 建議至少 70%，否則 TIR/TBR/TAR 可能偏差") }
        analysis.validityStatus = reasons.isEmpty ? "usable" : "limited"
        analysis.validityReasons = reasons

        let hypo = metrics.tbrBelow70 > 4 || metrics.tbrBelow54 > 1
        let high = metrics.tir70to180 < 70 || metrics.tarAbove180 > 25 || metrics.tarAbove250 > 5
        analysis.priority = hypo ? "先處理低血糖風險，再改善餐後高血糖" : (high ? "先找出主要高血糖時段，再分餐別調整" : "維持整體控制，針對餐後尖峰微調")

        if hypo { analysis.safetyAlerts.append("TBR <70 \(metrics.tbrBelow70)% 或 <54 \(metrics.tbrBelow54)% 超過建議上限，需優先降低低血糖風險") }
        if patterns.nocturnalLow || patterns.fastingLow { analysis.safetyAlerts.append("夜間或空腹低血糖提示 basal insulin、晚間藥物或睡前點心需檢視") }
        if metrics.cv > 36 { analysis.safetyAlerts.append("CV \(metrics.cv)% >36%，代表血糖波動偏大，治療調整要避免只追求平均值") }

        if patterns.nocturnalLow || patterns.fastingLow { analysis.possibleCauses.append("basal insulin 劑量偏高、晚餐後活動量增加、腎功能下降造成藥物作用延長，或睡前碳水不足") }
        if profile.therapies.contains(.sulfonylurea) { analysis.possibleCauses.append("sulfonylurea 在 CKD 或進食不穩時會增加低血糖風險") }
        if patterns.postBreakfastSpike { analysis.possibleCauses.append("早餐後尖峰常見原因包括粥、麵包、含糖飲料、主食集中或蛋白質不足") }
        if patterns.postLunchSpike { analysis.possibleCauses.append("午餐後尖峰需檢視便當飯量、飲料、水果與餐前藥效銜接") }
        if patterns.postDinnerSpike { analysis.possibleCauses.append("晚餐後尖峰常見於外食、高脂餐、宵夜或晚餐 insulin 不足") }
        if patterns.lateEveningHyperglycemia { analysis.possibleCauses.append("晚間延遲性高血糖可來自高脂晚餐、宵夜或運動後補食過量") }

        if patterns.postBreakfastSpike { analysis.dietKeyPoints.append("早餐先調整主食種類與份量：白粥、麵包、甜飲改為定量全穀雜糧並搭配蛋白質") }
        if patterns.postLunchSpike { analysis.dietKeyPoints.append("午餐檢查飯量、飲料與水果時間，優先建立固定碳水份量") }
        if patterns.postDinnerSpike || patterns.lateEveningHyperglycemia { analysis.dietKeyPoints.append("晚餐與宵夜拆開檢視，避免高脂大餐與睡前澱粉/水果集中") }
        if patterns.nocturnalLow || patterns.fastingLow { analysis.dietKeyPoints.append("若有夜間低血糖，飲食調整不能只減醣，需同步檢視晚餐量、睡前點心與藥效時間") }
        if analysis.dietKeyPoints.isEmpty { analysis.dietKeyPoints.append("請補上三餐照片、份量、點心、運動與用藥時間，以判斷飲食介入點") }

        if hypo { analysis.treatmentSuggestions.append("治療優先順序為降低低血糖：先檢視 insulin 或促胰島素分泌藥，再談強化降糖") }
        if patterns.nocturnalLow || patterns.fastingLow { analysis.treatmentSuggestions.append("若使用 basal insulin，可評估降低夜間 basal、調整注射時間，或改用低低血糖風險方案") }
        if profile.therapies.contains(.sulfonylurea) { analysis.treatmentSuggestions.append("sulfonylurea 可考慮減量、停用或改用低低血糖風險藥物，特別是 CKD、長者或進食不穩者") }
        if profile.kidneyContext.uppercased().contains("CKD") { analysis.treatmentSuggestions.append("CKD 病人需依 eGFR 調整用藥，避免藥物蓄積，並把低血糖風險列為第一安全目標") }
        if high && !hypo { analysis.treatmentSuggestions.append("若低血糖少而餐後 TAR 高，可考慮強化餐前治療、GLP-1 RA/SGLT2 inhibitor 適應性或餐前 insulin 策略") }
        if analysis.treatmentSuggestions.isEmpty { analysis.treatmentSuggestions.append("目前藥物可先維持，聚焦造成尖峰的餐別、份量與運動安排，並追蹤下一份 AGP") }

        analysis.reportText = report(metrics: metrics, analysis: analysis)
        return analysis
    }

    private static func report(metrics: AGPMetrics, analysis: AGPAnalysis) -> String {
        """
        AGP 判讀摘要
        資料品質：\(analysis.validityStatus == "usable" ? "可判讀" : "有限制")。\(analysis.validityReasons.joined(separator: "；"))
        核心指標：TIR \(metrics.tir70to180)%、TBR <70 \(metrics.tbrBelow70)%、TAR >180 \(metrics.tarAbove180)%、CV \(metrics.cv)%。
        優先處理：\(analysis.priority)。

        可能原因
        \(analysis.possibleCauses.map { "- \($0)" }.joined(separator: "\n"))

        飲食調整關鍵點
        \(analysis.dietKeyPoints.map { "- \($0)" }.joined(separator: "\n"))

        治療建議
        \(analysis.treatmentSuggestions.map { "- \($0)" }.joined(separator: "\n"))
        """
    }
}

@MainActor
final class CGMSStore: ObservableObject {
    @Published var readings: [GlucoseReading] = []
    @Published var metrics = AGPMetrics(hourlySummary: (0..<24).map { HourlySummary(hour: $0, median: nil, p10: nil, p25: nil, p75: nil, p90: nil) })
    @Published var patterns = PatternFlags()
    @Published var profile = TreatmentProfile()
    @Published var analysis = AGPAnalysis()
    @Published var route: AGPSection = .summary
    @Published var importError: String?

    private let summaryKey = "latest-agp-summary"

    init() {
        analyzeManual()
        restoreLatestSummary()
    }

    func importCSV(url: URL) {
        do {
            let secured = url.startAccessingSecurityScopedResource()
            defer { if secured { url.stopAccessingSecurityScopedResource() } }
            let text = try String(contentsOf: url, encoding: .utf8)
            let parsed = try LibreCSVParser.parse(text)
            readings = parsed
            metrics = AGPCalculator.metrics(for: parsed)
            patterns = AGPCalculator.patterns(readings: parsed, profile: profile)
            analysis = AGPAnalyzer.analyze(metrics: metrics, patterns: patterns, profile: profile)
            importError = nil
            route = .summary
            saveLatestSummary()
        } catch {
            importError = error.localizedDescription
            route = .importData
        }
    }

    func analyzeManual() {
        patterns = PatternFlags()
        analysis = AGPAnalyzer.analyze(metrics: metrics, patterns: patterns, profile: profile)
        saveLatestSummary()
    }

    func reanalyze() {
        if readings.isEmpty {
            analyzeManual()
        } else {
            patterns = AGPCalculator.patterns(readings: readings, profile: profile)
            analysis = AGPAnalyzer.analyze(metrics: metrics, patterns: patterns, profile: profile)
            saveLatestSummary()
        }
    }

    private func saveLatestSummary() {
        let summary = AGPReportSummary(
            id: UUID(),
            createdAt: Date(),
            dateRange: readingsDateRange(),
            tir: metrics.tir70to180,
            tbr: metrics.tbrBelow70,
            tar: metrics.tarAbove180,
            cv: metrics.cv,
            priority: analysis.priority
        )
        if let data = try? JSONEncoder().encode(summary) {
            UserDefaults.standard.set(data, forKey: summaryKey)
        }
    }

    private func restoreLatestSummary() {
        guard let data = UserDefaults.standard.data(forKey: summaryKey), let summary = try? JSONDecoder().decode(AGPReportSummary.self, from: data) else { return }
        metrics.tir70to180 = summary.tir
        metrics.tbrBelow70 = summary.tbr
        metrics.tarAbove180 = summary.tar
        metrics.cv = summary.cv
    }

    private func readingsDateRange() -> String {
        guard let first = readings.first?.timestamp, let last = readings.last?.timestamp else { return "manual AGP" }
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy/MM/dd"
        return "\(formatter.string(from: first))-\(formatter.string(from: last))"
    }
}

extension Array where Element == Double {
    var average: Double { isEmpty ? 0 : reduce(0, +) / Double(count) }
    var standardDeviation: Double {
        guard !isEmpty else { return 0 }
        let mean = average
        return sqrt(map { pow($0 - mean, 2) }.reduce(0, +) / Double(count))
    }

    func percentile(_ p: Double) -> Double? {
        guard !isEmpty else { return nil }
        let sorted = sorted()
        let index = (Double(sorted.count - 1) * p)
        let lower = Int(floor(index))
        let upper = Int(ceil(index))
        if lower == upper { return sorted[lower] }
        return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - Double(lower))
    }
}

extension Double {
    var rounded1: Double { (self * 10).rounded() / 10 }
}

func percent(_ count: Int, _ total: Int) -> Double {
    guard total > 0 else { return 0 }
    return (Double(count) / Double(total) * 100).rounded1
}

extension Array where Element: Hashable {
    func uniqued() -> [Element] {
        var seen = Set<Element>()
        return filter { seen.insert($0).inserted }
    }
}
