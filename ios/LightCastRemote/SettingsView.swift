import SwiftUI
import WebKit

struct SettingsView: View {
    @Binding var server: String
    var onChange: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text = Config.server
    @State private var error: String?
    @State private var confirmReset = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(Config.defaultServer, text: $text)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .keyboardType(.URL)
                    if let error { Text(error).foregroundStyle(.red).font(.footnote) }
                } header: { Text("교회 서버 주소") } footer: {
                    Text("LightCast 컴퓨터의 설정 → 리모컨에 나오는 서버(Worker) 주소입니다. 보통 바꿀 필요가 없습니다.")
                }
                Section {
                    Button("기본 주소로 되돌리기") { text = Config.defaultServer }
                    Button("저장된 컴퓨터 연결 지우기", role: .destructive) { confirmReset = true }
                }
                Section {
                    LabeledContent("버전", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")
                } footer: { Text("두 손가락으로 화면을 1초 길게 누르면 이 창이 열립니다.") }
            }
            .navigationTitle("LightCast 리모컨")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("저장", action: save) }
            }
            .confirmationDialog("이 아이폰에 저장된 컴퓨터 연결과 로그인 정보를 지울까요?", isPresented: $confirmReset, titleVisibility: .visible) {
                Button("지우기", role: .destructive) {
                    WKWebsiteDataStore.default().removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast) {
                        onChange(); dismiss()
                    }
                }
            }
        }
    }

    private func save() {
        guard let value = Config.normalize(text) else { error = "https:// 로 시작하는 올바른 주소를 입력해 주세요."; return }
        Config.server = value
        server = value
        onChange()
        dismiss()
    }
}
