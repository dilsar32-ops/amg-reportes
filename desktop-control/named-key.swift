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
// Keep the demonstration on the display where the user gave the order.
let start = CGEvent(source:nil)?.location ?? .zero
let screen = NSScreen.screens.first { screen in
    guard let n = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else {return false}
    return CGDisplayBounds(n.uint32Value).contains(start)
}
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
if let screen, let raw = attr(ax,"AXFocusedWindow") {
    let window = raw as! AXUIElement
    if let middle = center(window), let n = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber {
        let bounds = CGDisplayBounds(n.uint32Value)
        if !bounds.contains(middle), let value = attr(window,"AXSize") {
            var size = CGSize.zero
            if AXValueGetValue(value as! AXValue,.cgSize,&size) {
                var origin = CGPoint(x:bounds.midX-size.width/2,y:bounds.midY-size.height/2)
                guard let pos=AXValueCreate(.cgPoint,&origin), AXUIElementSetAttributeValue(window,"AXPosition" as CFString,pos) == .success else {stop("No pude traer la Calculadora a tu pantalla.")}
            }
        }
    }
}
var key: AXUIElement?
for _ in 0..<15 {key=locate(); if key != nil {break}; Thread.sleep(forTimeInterval:0.08)}
guard let button=key, let destination=center(button) else {stop("Lumi no pudo leer la tecla "+digit+" en la ventana de Calculadora.")}
guard let from=CGEvent(source:nil)?.location else {stop("No pude localizar el puntero de la Mac.")}
let duration = min(0.70,max(0.28,hypot(destination.x-from.x,destination.y-from.y)/1500))
let began = ProcessInfo.processInfo.systemUptime
while true {
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier,
          !CGEventSource.buttonState(.combinedSessionState,button:.left) else {stop("El foco o el mouse cambió.")}
    let t=min(1,(ProcessInfo.processInfo.systemUptime-began)/duration)
    let eased=t*t*(3-2*t)
    let point=CGPoint(x:from.x+(destination.x-from.x)*eased,y:from.y+(destination.y-from.y)*eased)
    guard CGWarpMouseCursorPosition(point) == .success else {stop("No pude mover el cursor de la Mac.")}
    if t == 1 {break}
    Thread.sleep(forTimeInterval:1.0/120)
}
guard let same=locate(), CFEqual(button,same), center(same)==destination else {stop("La tecla cambió de posición.")}
let click=Process()
click.executableURL=FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications/LumiMouse.app/Contents/MacOS/LumiMouse")
click.arguments=["click","Calculator",String(Double(destination.x)),String(Double(destination.y))]
try click.run()
click.waitUntilExit()
exit(click.terminationStatus)
