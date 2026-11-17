import AppKit
import Network
import Security

let bridgePort: UInt16 = 8799
let allowedOrigins: Set<String> = ["https://ruruguy.github.io", "http://127.0.0.1:8787", "http://localhost:8787"]
let appID = "tranRU-Mac-Overlay"

struct CaptionPayload {
    struct Lane { let label: String; let text: String; let source: Bool }
    let lanes: [Lane]
    let color: String
    let size: CGFloat
    let lines: Int
    let outline: Bool
    let visible: Bool
    init(_ object: [String: Any]) throws {
        let raw = object["lanes"] as? [[String: Any]] ?? []
        guard raw.count <= 8 else { throw BridgeError.invalid }
        var parsed: [Lane] = []
        for lane in raw {
            guard let text = lane["text"] as? String, text.count <= 12000 else { throw BridgeError.invalid }
            let label = lane["label"] as? String ?? ""
            guard label.count <= 120 else { throw BridgeError.invalid }
            parsed.append(Lane(label: label, text: text, source: lane["source"] as? Bool ?? false))
        }
        let style = object["style"] as? [String: Any] ?? [:]
        let c = style["color"] as? String ?? "#ffffff"
        color = c.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil ? c : "#ffffff"
        let value = (style["size"] as? NSNumber)?.doubleValue ?? 32
        size = CGFloat(value.isFinite ? min(64, max(18, value)) : 32)
        lines = min(5, max(1, (style["lines"] as? Int) ?? 3))
        outline = style["outline"] as? Bool ?? true
        visible = object["visible"] as? Bool ?? true
        lanes = parsed
    }
}
enum BridgeError: Error { case invalid }
struct HTTPRequest {
    let method: String; let path: String; let headers: [String: String]; let body: Data
    static func parse(_ data: Data) throws -> HTTPRequest? {
        guard data.count <= 131072 else { throw BridgeError.invalid }
        guard let split = data.range(of: Data("\r\n\r\n".utf8)) else { if data.count > 16384 { throw BridgeError.invalid }; return nil }
        guard let head = String(data: data[..<split.lowerBound], encoding: .utf8) else { throw BridgeError.invalid }
        let lines = head.components(separatedBy: "\r\n")
        let first = (lines.first ?? "").split(separator: " ")
        guard first.count == 3, first[2] == "HTTP/1.1" else { throw BridgeError.invalid }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":") else { throw BridgeError.invalid }
            let key = line[..<colon].lowercased()
            guard headers[key] == nil else { throw BridgeError.invalid }
            headers[key] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        }
        guard headers["transfer-encoding"] == nil else { throw BridgeError.invalid }
        if first[0] == "POST" && headers["content-length"] == nil { throw BridgeError.invalid }
        guard let length = Int(headers["content-length"] ?? "0"), length >= 0, length <= 114688 else { throw BridgeError.invalid }
        let end = split.upperBound + length
        guard data.count >= end else { return nil }
        return HTTPRequest(method: String(first[0]), path: String(first[1]), headers: headers, body: data[split.upperBound..<end])
    }
}
func secureCode() -> String {
    var bytes = [UInt8](repeating: 0, count: 16)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { fatalError("無法建立安全連線碼") }
    return bytes.map { String(format: "%02x", $0) }.joined()
}
func tokenMatches(_ candidate: String, _ expected: String) -> Bool {
    let a = Array(candidate.utf8), b = Array(expected.utf8)
    guard a.count == b.count else { return false }
    var difference: UInt8 = 0
    for i in a.indices { difference |= a[i] ^ b[i] }
    return difference == 0
}
final class CaptionBridge {
    let code: String
    let onCaption: (CaptionPayload) -> Void
    let onState: (String) -> Void
    var listener: NWListener?
    let queue = DispatchQueue(label: "tranru.caption-bridge")
    init(code: String, onCaption: @escaping (CaptionPayload) -> Void, onState: @escaping (String) -> Void) {
        self.code = code; self.onCaption = onCaption; self.onState = onState
    }
    func start(port: UInt16 = bridgePort) throws {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: NWEndpoint.Host("127.0.0.1"), port: NWEndpoint.Port(rawValue: port)!)
        let server = try NWListener(using: parameters)
        listener = server
        server.stateUpdateHandler = { [weak self] state in
            if case .ready = state { self?.onState("已就緒，請將連線碼貼到網站的「字幕樣式」。") }
            if case .failed = state { self?.onState("無法開啟本機連線，請確認沒有重複開啟工具或其他程式佔用 8799。") }
        }
        server.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
        server.start(queue: queue)
    }
    func accept(_ connection: NWConnection) {
        connection.start(queue: queue)
        queue.asyncAfter(deadline: .now() + 10) { connection.cancel() }
        receive(connection, buffer: Data())
    }
    func receive(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16384) { [weak self] data, _, complete, error in
            guard let self = self else { connection.cancel(); return }
            var bytes = buffer; if let data = data { bytes.append(data) }
            do {
                if let request = try HTTPRequest.parse(bytes) { self.handle(request, connection); return }
                if complete || error != nil { connection.cancel(); return }
                self.receive(connection, buffer: bytes)
            } catch { self.reply(connection, status: 400, object: ["error": "無效的請求"], origin: nil) }
        }
    }
    func handle(_ request: HTTPRequest, _ connection: NWConnection) {
        let origin = request.headers["origin"]
        guard origin == nil || allowedOrigins.contains(origin!) else { reply(connection, status: 403, object: ["error": "不允許的網站來源"], origin: nil); return }
        guard let host = request.headers["host"], host == "127.0.0.1:\(bridgePort)" || host == "localhost:\(bridgePort)" else { reply(connection, status: 403, object: ["error": "不允許的主機"], origin: origin); return }
        if request.method == "OPTIONS" { reply(connection, status: 200, object: ["ok": true], origin: origin); return }
        guard request.method == "POST", ["/hello", "/captions"].contains(request.path) else { reply(connection, status: 404, object: ["error": "找不到端點"], origin: origin); return }
        guard tokenMatches(request.headers["authorization"] ?? "", "Bearer " + code) else { reply(connection, status: 401, object: ["error": "連線碼不正確，請從 Mac 工具重新複製"], origin: origin); return }
        if request.path == "/hello" { reply(connection, status: 200, object: ["app": appID, "version": "1.0.0"], origin: origin); return }
        do {
            guard let object = try JSONSerialization.jsonObject(with: request.body) as? [String: Any] else { throw BridgeError.invalid }
            let payload = try CaptionPayload(object)
            onCaption(payload)
            reply(connection, status: 200, object: ["ok": true, "app": appID], origin: origin)
        } catch { reply(connection, status: 400, object: ["error": "字幕資料格式錯誤"], origin: origin) }
    }
    func reply(_ connection: NWConnection, status: Int, object: [String: Any], origin: String?) {
        let body = (try? JSONSerialization.data(withJSONObject: object)) ?? Data()
        var head = "HTTP/1.1 \(status) \(status == 200 ? "OK" : "Error")\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: \(body.count)\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n"
        if let origin = origin {
            head += "Access-Control-Allow-Origin: \(origin)\r\nVary: Origin\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: Authorization, Content-Type\r\nAccess-Control-Allow-Private-Network: true\r\n"
        }
        var response = Data((head + "\r\n").utf8); response.append(body)
        connection.send(content: response, completion: .contentProcessed { _ in connection.cancel() })
    }
}

final class CaptionView: NSView {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
final class OverlayController {
    let window: NSPanel
    var payload: CaptionPayload?
    var widthRatio: CGFloat = 0.82
    var fontScale: CGFloat = 1
    var position = 0
    var showLabels = false
    var hiddenByUser = false
    init() {
        window = NSPanel(contentRect: NSRect(x: 100, y: 80, width: 900, height: 160), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        window.isOpaque = false; window.backgroundColor = .clear; window.hasShadow = false
        window.level = .floating; window.isFloatingPanel = true; window.hidesOnDeactivate = false
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        window.ignoresMouseEvents = true; window.isMovableByWindowBackground = true
        window.isReleasedWhenClosed = false
    }
    func color(_ hex: String) -> NSColor {
        let value = UInt32(hex.dropFirst(), radix: 16) ?? 0xffffff
        return NSColor(srgbRed: CGFloat((value >> 16) & 255)/255, green: CGFloat((value >> 8) & 255)/255, blue: CGFloat(value & 255)/255, alpha: 1)
    }
    func update(_ value: CaptionPayload, reposition: Bool = false) {
        payload = value
        guard value.visible && !hiddenByUser else { window.orderOut(nil); return }
        let lanes = value.lanes.filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        guard !lanes.isEmpty else { window.orderOut(nil); return }
        let screen = window.screen ?? NSScreen.main ?? NSScreen.screens[0]
        let frame = screen.visibleFrame
        let size = min(86, max(14, value.size * fontScale))
        let height = min(frame.height * 0.75, CGFloat(lanes.count) * (size * 1.48 * CGFloat(value.lines) + (showLabels ? 20 : 0)) + 12)
        let width = frame.width * widthRatio
        var origin = window.frame.origin
        if !window.isVisible || reposition {
            origin.x = frame.midX - width / 2
            origin.y = position == 1 ? frame.maxY - height - 32 : frame.minY + 42
        }
        origin.x = min(frame.maxX - width, max(frame.minX, origin.x)); origin.y = min(frame.maxY-height, max(frame.minY, origin.y))
        window.setFrame(NSRect(origin: origin, size: NSSize(width: width, height: height)), display: false)
        let root = CaptionView(frame: NSRect(x: 0, y: 0, width: width, height: height))
        let laneHeight = (height - 12) / CGFloat(lanes.count)
        for (index, lane) in lanes.enumerated() {
            let laneFont = lane.source ? size * 0.75 : size
            let labelHeight: CGFloat = showLabels ? 18 : 0
            let y = height - 6 - CGFloat(index+1) * laneHeight
            if showLabels {
                let label = NSTextField(labelWithString: lane.label); label.font = .systemFont(ofSize: 11); label.textColor = color(value.color).withAlphaComponent(0.8)
                label.alignment = .center; label.frame = NSRect(x: 0, y: y + laneHeight - 18, width: width, height: 18); root.addSubview(label)
            }
            let scroll = NSScrollView(frame: NSRect(x: 4, y: y, width: width-8, height: laneHeight-labelHeight))
            scroll.drawsBackground = false; scroll.contentView.drawsBackground = false; scroll.borderType = .noBorder; scroll.hasVerticalScroller = false; scroll.hasHorizontalScroller = false
            let text = NSTextView(frame: NSRect(x: 0, y: 0, width: width-8, height: laneHeight-labelHeight))
            text.isEditable = false; text.isSelectable = false; text.drawsBackground = false
            text.isVerticallyResizable = true; text.isHorizontallyResizable = false; text.autoresizingMask = [.width]
            text.textContainer?.widthTracksTextView = true; text.textContainer?.containerSize = NSSize(width: width-8, height: .greatestFiniteMagnitude)
            text.textContainerInset = NSSize(width: 8, height: 0)
            let paragraph = NSMutableParagraphStyle(); paragraph.alignment = .center; paragraph.lineSpacing = laneFont * 0.12
            var attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: laneFont, weight: .semibold), .foregroundColor: color(value.color), .paragraphStyle: paragraph]
            if value.outline { attributes[.strokeColor] = NSColor.black; attributes[.strokeWidth] = -3.0; let shadow = NSShadow(); shadow.shadowColor = NSColor.black.withAlphaComponent(0.9); shadow.shadowBlurRadius = 4; shadow.shadowOffset = NSSize(width: 0, height: -1); attributes[.shadow] = shadow }
            text.textStorage?.setAttributedString(NSAttributedString(string: lane.text, attributes: attributes))
            scroll.documentView = text; root.addSubview(scroll)
            text.layoutManager?.ensureLayout(for: text.textContainer!); text.sizeToFit()
            text.scrollRangeToVisible(NSRange(location: (lane.text as NSString).length, length: 0))
        }
        window.contentView = root
        window.orderFrontRegardless()
    }
    func refresh() { if let payload = payload { update(payload, reposition: true) } }
    func demo() { hiddenByUser = false; if let demo = try? CaptionPayload(["lanes": [["label":"繁體中文", "text":"這是透明字幕示範，後方簡報仍然看得見。"]], "style": ["color":"#ffffff", "size":38, "lines":2, "outline":true]]) { update(demo, reposition: true) } }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    let code = secureCode()
    var bridge: CaptionBridge?
    var overlay: OverlayController!
    var controls: NSWindow!
    let status = NSTextField(wrappingLabelWithString: "啟動本機字幕連線中…")
    var codeField: NSTextField!
    func applicationDidFinishLaunching(_ notification: Notification) {
        overlay = OverlayController()
        buildControls()
        let server = CaptionBridge(code: code, onCaption: { [weak self] payload in DispatchQueue.main.async { self?.overlay.update(payload); self?.status.stringValue = payload.visible ? "已收到網站字幕；未收音或已停止時會保留最後字幕。" : "已停止字幕同步。" } }, onState: { [weak self] message in DispatchQueue.main.async { self?.status.stringValue = message } })
        bridge = server
        do { try server.start() } catch { status.stringValue = "無法啟動連線，請確認沒有重複開啟工具。" }
    }
    func buildControls() {
        controls = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 560, height: 560), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        controls.title = "tranRU 透明字幕 · 製作者：大佛A-Ru"; controls.isReleasedWhenClosed = false; controls.center()
        let content = NSStackView(); content.orientation = .vertical; content.alignment = .leading; content.spacing = 14; content.translatesAutoresizingMaskIntoConstraints = false
        controls.contentView!.addSubview(content)
        NSLayoutConstraint.activate([content.leadingAnchor.constraint(equalTo: controls.contentView!.leadingAnchor, constant: 24), content.trailingAnchor.constraint(equalTo: controls.contentView!.trailingAnchor, constant: -24), content.topAnchor.constraint(equalTo: controls.contentView!.topAnchor, constant: 24)])
        let title = NSTextField(labelWithString: "tranRU · Mac 透明字幕"); title.font = .boldSystemFont(ofSize: 22); content.addArrangedSubview(title)
        let help = NSTextField(wrappingLabelWithString: "1. 複製連線碼。\n2. 在網站「字幕樣式」貼上，點「連接 Mac 透明字幕」。\n3. 回到 PPT 播放。保持此工具與網站開啟。")
        help.preferredMaxLayoutWidth = 512; content.addArrangedSubview(help)
        codeField = NSTextField(string: code); codeField.isEditable = false; codeField.isSelectable = true; codeField.font = .monospacedSystemFont(ofSize: 13, weight: .regular)
        let pair = NSStackView(views: [codeField, button("複製連線碼", #selector(copyCode))]); pair.orientation = .horizontal; pair.spacing = 10; content.addArrangedSubview(pair)
        let lock = NSButton(checkboxWithTitle: "鎖定字幕位置／滑鼠穿透（可直接操作後方 PPT）", target: self, action: #selector(lockChanged)); lock.state = .on; content.addArrangedSubview(lock)
        let labels = NSButton(checkboxWithTitle: "顯示語言名稱", target: self, action: #selector(labelsChanged)); content.addArrangedSubview(labels)
        let size = NSSlider(value: 1, minValue: 0.6, maxValue: 1.8, target: self, action: #selector(scaleChanged))
        content.addArrangedSubview(row("字體縮放", size))
        let width = NSSlider(value: 0.82, minValue: 0.35, maxValue: 0.98, target: self, action: #selector(widthChanged))
        content.addArrangedSubview(row("字幕寬度", width))
        let actions = NSStackView(views: [button("放在下方", #selector(bottom)), button("放在上方", #selector(top)), button("展示範例", #selector(demo)), button("顯示／隱藏", #selector(hide))]); actions.spacing = 8; content.addArrangedSubview(actions)
        status.preferredMaxLayoutWidth = 512; status.font = .systemFont(ofSize: 12); status.textColor = .secondaryLabelColor; content.addArrangedSubview(status)
        let privacy = NSTextField(wrappingLabelWithString: "僅在這台 Mac 接收字幕與樣式。不接收 API 金鑰、錄音，也不寫入字幕檔案。連線碼每次啟動重新產生。")
        privacy.preferredMaxLayoutWidth = 512; privacy.font = .systemFont(ofSize: 11); privacy.textColor = .secondaryLabelColor; content.addArrangedSubview(privacy)
        let menu = NSMenu(); let appMenuItem = NSMenuItem(); menu.addItem(appMenuItem); let appMenu = NSMenu(); appMenuItem.submenu = appMenu
        appMenu.addItem(withTitle: "顯示設定", action: #selector(showControls), keyEquivalent: ",").target = self
        appMenu.addItem(withTitle: "結束 tranRU 透明字幕", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        NSApp.mainMenu = menu
        controls.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
    }
    func button(_ title: String, _ action: Selector) -> NSButton { NSButton(title: title, target: self, action: action) }
    func row(_ title: String, _ control: NSView) -> NSView { let stack = NSStackView(views: [NSTextField(labelWithString: title), control]); stack.orientation = .horizontal; stack.spacing = 12; control.widthAnchor.constraint(equalToConstant: 350).isActive = true; return stack }
    @objc func copyCode() { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(code, forType: .string); status.stringValue = "連線碼已複製；貼到網站「字幕樣式」即可。" }
    @objc func lockChanged(_ sender: NSButton) { overlay.window.ignoresMouseEvents = sender.state == .on; status.stringValue = sender.state == .on ? "字幕已鎖定，滑鼠可操作後方簡報。" : "可拖曳字幕移動位置，完成後建議重新鎖定。" }
    @objc func labelsChanged(_ sender: NSButton) { overlay.showLabels = sender.state == .on; overlay.refresh() }
    @objc func scaleChanged(_ sender: NSSlider) { overlay.fontScale = CGFloat(sender.doubleValue); overlay.refresh() }
    @objc func widthChanged(_ sender: NSSlider) { overlay.widthRatio = CGFloat(sender.doubleValue); overlay.refresh() }
    @objc func bottom() { overlay.position = 0; overlay.refresh() }
    @objc func top() { overlay.position = 1; overlay.refresh() }
    @objc func demo() { overlay.demo() }
    @objc func hide() { overlay.hiddenByUser.toggle(); overlay.refresh(); status.stringValue = overlay.hiddenByUser ? "字幕已隱藏，按「顯示／隱藏」恢復。" : "已恢復字幕顯示。" }
    @objc func showControls() { controls.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { showControls(); return true }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationWillTerminate(_ notification: Notification) { bridge?.listener?.cancel(); overlay.window.orderOut(nil) }
}

func protocolTests() throws {
    let raw = Data("POST /hello HTTP/1.1\r\nHost: 127.0.0.1:8799\r\nContent-Length: 2\r\n\r\n{}".utf8)
    let partial = try HTTPRequest.parse(raw.dropLast())
    let full = try HTTPRequest.parse(raw)
    precondition(partial == nil)
    precondition(full?.path == "/hello")
    for text in ["POST /hello HTTP/1.1\r\nContent-Length: -1\r\n\r\n", "POST /hello HTTP/1.1\r\nContent-Length: 1\r\nContent-Length: 1\r\n\r\nx"] {
        do { _ = try HTTPRequest.parse(Data(text.utf8)); fatalError("Invalid request accepted") } catch {}
    }
    precondition(tokenMatches("same", "same") && !tokenMatches("same", "wrong"))
    let payload = try CaptionPayload(["lanes": [["text":"你好 Bonjour 日本語" ]], "style": ["color":"bad", "size":999, "lines":99]])
    precondition(payload.color == "#ffffff" && payload.size == 64 && payload.lines == 5)
    print("Native protocol, authentication and payload validation passed")
}
if CommandLine.arguments.contains("--self-test") {
    do { try protocolTests(); exit(0) } catch { fputs("Native self-test failed\n", stderr); exit(1) }
} else if CommandLine.arguments.contains("--bridge-test") {
    let server = CaptionBridge(code: String(repeating: "a", count: 32), onCaption: { _ in }, onState: { _ in })
    do { try server.start(); withExtendedLifetime(server) { dispatchMain() } } catch { exit(1) }
} else {
    let app = NSApplication.shared; let delegate = AppDelegate(); app.delegate = delegate; app.setActivationPolicy(.regular); app.run()
}
