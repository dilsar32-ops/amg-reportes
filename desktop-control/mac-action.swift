import AppKit
import ApplicationServices

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data(message.utf8))
    exit(1)
}
let args = Array(CommandLine.arguments.dropFirst())
guard args.count >= 2 else { fail("Falta la aplicación de destino.") }
let action = args[0], name = args[1]
let aliases = ["calculadora":"Calculator", "vista previa":"Preview", "notas":"Notes", "calendario":"Calendar", "buscador":"Finder", "chrome":"Google Chrome"]
let target = aliases[name.lowercased()] ?? name
let roots = ["/Applications", "/System/Applications", "/System/Applications/Utilities", "/System/Library/CoreServices", NSHomeDirectory()+"/Applications"]
let apps = roots.flatMap { root in
    ((try? FileManager.default.contentsOfDirectory(atPath: root)) ?? []).filter {
        $0.pathExtensionIsApp && String($0.dropLast(4)).caseInsensitiveCompare(target) == .orderedSame
    }.map { URL(fileURLWithPath:root).appendingPathComponent($0) }
}
extension String { var pathExtensionIsApp: Bool { lowercased().hasSuffix(".app") } }
guard apps.count == 1, let app = apps.first, let bundle = Bundle(url:app)?.bundleIdentifier else { fail("No encontré una aplicación instalada con ese nombre exacto.") }
guard ["open","point","click"].contains(action) else { fail("Orden desconocida.") }
if action == "open" {
    NSWorkspace.shared.openApplication(at:app, configuration:NSWorkspace.OpenConfiguration()) { running,error in
        guard running?.bundleIdentifier == bundle, error == nil else { fail("macOS no pudo abrir la aplicación.") }
        print("Abierta: "+target); exit(0)
    }
    RunLoop.main.run()
} else {
    guard args.count == 4, let x=Double(args[2]), let y=Double(args[3]), x.isFinite, y.isFinite else { fail("Coordenadas inválidas.") }
    guard AXIsProcessTrusted(), CGPreflightPostEventAccess() else { fail("macOS requiere Accesibilidad para el controlador LumiMouse.") }
    let p=CGPoint(x:x,y:y)
    guard let running=NSRunningApplication.runningApplications(withBundleIdentifier:bundle).first(where:{!$0.isTerminated}) else {fail("Abre primero la aplicación.")}
    running.activate(options:[.activateIgnoringOtherApps])
    func check() -> Bool {
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == running.processIdentifier else {return false}
        let windows=CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements], kCGNullWindowID) as? [[String:Any]] ?? []
        let hit=windows.first { w in
            guard (w[kCGWindowAlpha as String] as? Double ?? 1)>0,
                  let b=w[kCGWindowBounds as String] as? NSDictionary,
                  let r=CGRect(dictionaryRepresentation:b) else {return false}
            return r.contains(p)
        }
        return (hit?[kCGWindowOwnerPID as String] as? Int32) == running.processIdentifier
    }
    for _ in 0..<12 where !check() { Thread.sleep(forTimeInterval:0.05) }
    guard check(), !CGEventSource.buttonState(.combinedSessionState,button:.left) else {fail("El punto no está disponible en la ventana de destino.")}
    guard CGWarpMouseCursorPosition(p) == .success else {fail("No pude mover el puntero.")}
    if action == "click" {
        Thread.sleep(forTimeInterval:0.24)
        guard check(), let pos=CGEvent(source:nil)?.location, hypot(pos.x-x,pos.y-y)<2,
              let down=CGEvent(mouseEventSource:nil,mouseType:.leftMouseDown,mouseCursorPosition:p,mouseButton:.left),
              let up=CGEvent(mouseEventSource:nil,mouseType:.leftMouseUp,mouseCursorPosition:p,mouseButton:.left) else {fail("Cambió el destino antes del clic.")}
        down.post(tap:.cghidEventTap); up.post(tap:.cghidEventTap)
    }
    print(action == "point" ? "Puntero colocado en "+target : "Clic enviado a "+target)
}
