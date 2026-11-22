import AppKit
import ApplicationServices

func stop(_ text: String) -> Never {
    FileHandle.standardError.write(Data(text.utf8))
    exit(1)
}
func attr(_ element: AXUIElement, _ key: String) -> CFTypeRef? {
    var value: CFTypeRef?
    AXUIElementCopyAttributeValue(element, key as CFString, &value)
    return value
}
func center(_ button: AXUIElement) -> CGPoint? {
    var pos = CGPoint.zero, size = CGSize.zero
    guard let p = attr(button, "AXPosition"), let s = attr(button, "AXSize"),
          CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(s) == AXValueGetTypeID(),
          AXValueGetValue(p as! AXValue,.cgPoint,&pos), AXValueGetValue(s as! AXValue,.cgSize,&size),
          size.width > 0, size.height > 0 else {return nil}
    return CGPoint(x:pos.x+size.width/2,y:pos.y+size.height/2)
}
let digit = CommandLine.arguments.last ?? ""
guard digit.count == 1, "0123456789".contains(digit) else {stop("Indica un dígito.")}
guard let app = NSRunningApplication.runningApplications(withBundleIdentifier:"com.apple.calculator").first else {stop("Abre la Calculadora.")}
app.activate(options:[])
let ax = AXUIElementCreateApplication(app.processIdentifier)
func locate() -> AXUIElement? {
    guard let window = attr(ax,"AXFocusedWindow") else {return nil}
    var queue = [window as! AXUIElement], found = [AXUIElement](), index = 0
    while index < queue.count && index < 600 {
        let el = queue[index]; index += 1
        if attr(el,"AXRole") as? String == "AXButton",
           [attr(el,"AXDescription"),attr(el,"AXTitle")].contains(where: { $0 as? String == digit }) {found.append(el)}
        queue += attr(el,"AXChildren") as? [AXUIElement] ?? []
    }
    return found.count == 1 ? found[0] : nil
}
var key: AXUIElement?
for _ in 0..<15 {key=locate(); if key != nil {break}; Thread.sleep(forTimeInterval:0.08)}
guard let button=key, let destination=center(button) else {stop("Lumi no pudo leer la tecla "+digit+" en la ventana de Calculadora.")}
let ns = NSApplication.shared
ns.setActivationPolicy(.accessory)
let panel=NSPanel(contentRect:NSRect(x:0,y:0,width:124,height:48),styleMask:[.borderless,.nonactivatingPanel],backing:.buffered,defer:false)
panel.level = .floating
panel.ignoresMouseEvents=true
panel.isOpaque=false
panel.backgroundColor = .clear
panel.collectionBehavior=[.canJoinAllSpaces,.fullScreenAuxiliary]
let badge=NSTextField(labelWithString:"➤  LUMI")
badge.font = .boldSystemFont(ofSize:22)
badge.alignment = .center
badge.textColor = .white
badge.wantsLayer=true
badge.layer?.backgroundColor=NSColor.systemBlue.cgColor
badge.layer?.cornerRadius=10
panel.contentView=badge
let top=CGDisplayBounds(CGMainDisplayID()).height
let start=CGPoint(x:destination.x+100,y:destination.y-85)
func display(_ p:CGPoint) {
    panel.setFrameOrigin(NSPoint(x:p.x-126,y:top-p.y-24))
    panel.orderFrontRegardless()
    RunLoop.current.run(until:Date(timeIntervalSinceNow:0.025))
}
for i in 0...80 {
    let t=Double(i)/80
    display(CGPoint(x:start.x+(destination.x-start.x)*t,y:start.y+(destination.y-start.y)*t))
}
guard let same=locate(), CFEqual(button,same), center(same)==destination else {stop("La tecla cambió de posición.")}
let click=Process()
click.executableURL=FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications/LumiMouse.app/Contents/MacOS/LumiMouse")
click.arguments=["click","Calculator",String(Double(destination.x)),String(Double(destination.y))]
try click.run()
while click.isRunning {display(destination)}
guard click.terminationStatus == 0 else {exit(click.terminationStatus)}
for _ in 0..<70 {display(destination)}
