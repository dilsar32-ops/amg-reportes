import AppKit
import ApplicationServices
import Foundation
import CoreGraphics

// Private stdio helper. Coordinates are Quartz desktop points (including negative
// origins on additional displays), never screenshot pixels or browser CSS coordinates.
typealias JSON = [String: Any]

struct Block: Error, CustomStringConvertible {
    let description: String
    init(_ message: String) { description = message }
}

func encodePoint(_ point: CGPoint) -> JSON { ["x":point.x, "y":point.y] }
func encodeRect(_ rect: CGRect) -> JSON {
    ["x":rect.minX, "y":rect.minY, "width":rect.width, "height":rect.height]
}
func pointerPosition() throws -> CGPoint {
    guard let result = CGEvent(source:nil)?.location else { throw Block("El puntero no está disponible.") }
    return result
}

func ax(_ element: AXUIElement, _ key: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, key as CFString, &value) == .success else { return nil }
    return value
}
func asElement(_ value: CFTypeRef?) -> AXUIElement? {
    guard let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return (value as! AXUIElement)
}
func axRect(_ element: AXUIElement) -> CGRect? {
    guard let point = ax(element,kAXPositionAttribute), let size = ax(element,kAXSizeAttribute),
          CFGetTypeID(point) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
    var p = CGPoint.zero, s = CGSize.zero
    guard AXValueGetValue(point as! AXValue,.cgPoint,&p), AXValueGetValue(size as! AXValue,.cgSize,&s),
          s.width > 0, s.height > 0 else { return nil }
    return CGRect(origin:p,size:s)
}

func atmostOneParam(_ key: String, _ components: URLComponents) -> String? {
    let candidates = (components.queryItems ?? []).filter { $0.name == key }
    return candidates.count == 1 ? candidates[0].value : nil
}

func allowedURL(_ url: URL, model: String) -> Bool {
    guard let u = URLComponents(url:url,resolvingAgainstBaseURL:false),
          u.scheme?.lowercased() == "https", u.host?.lowercased() == "my.matterport.com",
          u.user == nil, u.password == nil, u.port == nil || u.port == 443 else { return false }
    let path = u.path.trimmingCharacters(in: CharacterSet(charactersIn:"/"))
    if path == "models/"+model { return true }
    if atmostOneParam("m",u) != model { return false }
    return path == "show" || (path == "work" && atmostOneParam("cloudEdit",u) == "1")
}

struct WindowSnapshot {
    let pid: pid_t
    let bundle: String
    let id: CGWindowID
    let element: AXUIElement?
    let web: AXUIElement?
    let url: URL?
    let bounds: CGRect
    let content: CGRect

    func same(_ b: WindowSnapshot) -> Bool {
        pid == b.pid && id == b.id && bundle == b.bundle && url == b.url &&
            bounds.equalTo(b.bounds) && content.equalTo(b.content) &&
            ((element == nil && b.element == nil) || (element != nil && b.element != nil && CFEqual(element!,b.element!))) && ((web == nil && b.web == nil) ||
                (web != nil && b.web != nil && CFEqual(web!,b.web!)))
    }
}

final class TestSurface: NSView {
    var down = 0, up = 0, drag = 0
    override var acceptsFirstResponder: Bool { true }
    override func mouseDown(with event:NSEvent) { down += 1 }
    override func mouseUp(with event:NSEvent) { up += 1 }
    override func mouseDragged(with event:NSEvent) { drag += 1 }
    override func draw(_ rect:NSRect) {
        NSColor.windowBackgroundColor.setFill()
        rect.fill()
        ("Superficie de prueba del puntero de Lumi" as NSString).draw(at:NSPoint(x:22,y:28),
            withAttributes:[.font:NSFont.systemFont(ofSize:18),.foregroundColor:NSColor.labelColor])
    }
}

func currentWindowInfo() -> [JSON] {
    (CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as? [JSON]) ?? []
}
func cgRect(_ info: JSON) -> CGRect? {
    guard let v = info[kCGWindowBounds as String] as? NSDictionary else { return nil }
    return CGRect(dictionaryRepresentation: v as CFDictionary)
}

final class PointerController {
    let model: String
    let readonly: Bool
    let test: Bool
    var testWindow: NSWindow?
    var testSurface: TestSurface?
    var ref: String?
    var inspected: WindowSnapshot?
    var inspectedAt: TimeInterval = 0
    var operationIDs = Set<String>()

    init(model: String, readonly: Bool, test: Bool) {
        self.model=model; self.readonly=readonly; self.test=test
    }

    func permissions() -> JSON {
        ["accessibility": AXIsProcessTrusted(),"postEvents":CGPreflightPostEventAccess(),
         "pid":ProcessInfo.processInfo.processIdentifier,"readOnly":readonly,"test":test]
    }
    func requireAccess() throws {
        guard AXIsProcessTrusted(), CGPreflightPostEventAccess() else {
            throw Block("macOS no ha concedido a este proceso Accesibilidad y envío de eventos. No se solicitaron permisos.")
        }
    }
    func showTest() {
        let w = NSWindow(contentRect:NSRect(x:0,y:0,width:520,height:300),
                         styleMask:[.titled,.closable],backing:.buffered,defer:false)
        w.title="Lumi · prueba local de puntero"
        w.isReleasedWhenClosed=false
        let view=TestSurface(frame:w.contentView!.bounds)
        w.contentView=view
        testSurface=view
        testWindow=w
        w.center()
        w.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps:true)
    }

    func snapshot() throws -> WindowSnapshot {
        try requireAccess()
        guard let front=NSWorkspace.shared.frontmostApplication else {throw Block("No hay aplicación frontal.")}
        let pid=front.processIdentifier, bundle=front.bundleIdentifier ?? ""
        let own = test && pid == ProcessInfo.processInfo.processIdentifier
        guard own || (!test && bundle == "com.apple.Safari") else {
            throw Block("La ventana frontal no es el destino autorizado.")
        }
        if own {
            guard let w=testWindow, w.isKeyWindow, w.attachedSheet == nil,
                  let view=testSurface, let info=currentWindowInfo().first(where:{
                    ($0[kCGWindowNumber as String] as? NSNumber)?.intValue == w.windowNumber &&
                    ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid
                  }), let bounds=cgRect(info) else {throw Block("No está al frente la ventana propia de prueba.")}
            let c=CGRect(x:bounds.minX+2,y:bounds.maxY-view.bounds.height+2,
                         width:view.bounds.width-4,height:view.bounds.height-4)
            return WindowSnapshot(pid:pid,bundle:bundle,id:CGWindowID(w.windowNumber),element:nil,web:nil,url:nil,bounds:bounds,content:c)
        }
        let app=AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app,0.3)
        guard let window=asElement(ax(app,kAXFocusedWindowAttribute)), let bounds=axRect(window),
              (ax(window,kAXSubroleAttribute) as? String) == "AXStandardWindow",
              ((ax(window,"AXSheets") as? [AXUIElement]) ?? []).isEmpty else {
            throw Block("Falta la ventana estándar activa o hay un diálogo.")
        }
        let info=currentWindowInfo().filter {
            ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid &&
            ($0[kCGWindowLayer as String] as? NSNumber)?.intValue == 0 &&
            cgRect($0)?.equalTo(bounds) == true
        }
        guard info.count == 1, let id=(info[0][kCGWindowNumber as String] as? NSNumber)?.uint32Value else {
            throw Block("No se pudo identificar inequívocamente la ventana frontal.")
        }
        let title=(ax(window,kAXTitleAttribute) as? String ?? "").lowercased()
        if ["preferences","settings","ajustes","preferencias","extensions","extensiones"].contains(where:title.contains) {
            throw Block("Ventana de ajustes o extensiones excluida.")
        }
        // A quick AX walk stops at each page root, excludes browser chrome and never reads form data.
        var queue=[window], index=0
        var pages:[(AXUIElement,URL,CGRect)]=[]
        while index<queue.count && index<600 {
            let el=queue[index]; index+=1
            if (ax(el,kAXRoleAttribute) as? String) == "AXWebArea" {
                let value=ax(el,kAXURLAttribute)
                let url = (value as? URL) ?? (value as? String).flatMap(URL.init(string:))
                if let url,allowedURL(url,model:model),let r=axRect(el),r.intersects(bounds) {
                    pages.append((el,url,r.intersection(bounds)))
                }
                continue
            }
            if let children=ax(el,kAXChildrenAttribute) as? [AXUIElement] {queue.append(contentsOf:children)}
        }
        guard pages.count==1 else {throw Block("La ventana no contiene un único lienzo web del modelo solicitado.")}
        let (el,url,content)=pages[0]
        return WindowSnapshot(pid:pid,bundle:bundle,id:id,element:window,web:el,url:url,bounds:bounds,content:content)
    }

    func verifyHit(_ p:CGPoint, _ s:WindowSnapshot) throws {
        guard s.content.insetBy(dx:1,dy:1).contains(p) else {throw Block("Punto fuera de la zona verificada.")}
        // A floating panel from another process can cover Safari without becoming frontmost.
        guard let top=currentWindowInfo().first(where:{row in
            guard (row[kCGWindowAlpha as String] as? NSNumber)?.doubleValue != 0 else {return false}
            return cgRect(row)?.contains(p)==true
        }), (top[kCGWindowNumber as String] as? NSNumber)?.uint32Value==s.id else {
            throw Block("El punto está cubierto por otra ventana o control del sistema.")
        }
        guard let web=s.web else {return}
        var hit: AXUIElement?
        let system=AXUIElementCreateSystemWide()
        AXUIElementSetMessagingTimeout(system,0.3)
        guard AXUIElementCopyElementAtPosition(system,Float(p.x),Float(p.y),&hit) == .success else {
            throw Block("No se pudo verificar el elemento bajo el puntero.")
        }
        for _ in 0..<40 {
            guard let el=hit else {break}
            if CFEqual(el,web) {return}
            let role=ax(el,kAXRoleAttribute) as? String ?? ""
            if ["AXTextField","AXSecureTextField","AXTextArea","AXMenu","AXMenuItem",
                "AXSheet","AXButton","AXLink","AXPopUpButton","AXCheckBox"].contains(role) {
                throw Block("El punto corresponde a un control y no al plano.")
            }
            hit=asElement(ax(el,kAXParentAttribute))
        }
        throw Block("El punto no pertenece al contenido web del modelo.")
    }

    func emit(_ kind:CGEventType, point:CGPoint, releaseTo pid:pid_t?=nil) throws {
        guard let event=CGEvent(mouseEventSource:nil,mouseType:kind,mouseCursorPosition:point,mouseButton:.left) else {
            throw Block("No se pudo crear el evento del puntero.")
        }
        if let pid { event.postToPid(pid) } else {event.post(tap:.cghidEventTap)}
    }
    func coords(_ r:JSON, _ keyX:String, _ keyY:String) throws -> CGPoint {
        guard let x=r[keyX] as? NSNumber, let y=r[keyY] as? NSNumber,
              CFGetTypeID(x) != CFBooleanGetTypeID(),CFGetTypeID(y) != CFBooleanGetTypeID(),
              x.doubleValue.isFinite,y.doubleValue.isFinite else {throw Block("Faltan las coordenadas verificadas.")}
        return CGPoint(x:x.doubleValue,y:y.doubleValue)
    }
    func checked(_ s:WindowSnapshot,_ p:CGPoint) throws {
        guard try snapshot().same(s) else {throw Block("Cambió el foco, la ventana o la página.")}
        try verifyHit(p,s)
    }

    func handle(_ r:JSON) throws -> JSON {
        let action=r["action"] as? String ?? ""
        switch action {
        case "ping": return permissions()
        case "position": return ["position":encodePoint(try pointerPosition())]
        case "close":
            testWindow?.close()
            return ["closed":true]
        case "inspect":
            let s=try snapshot(), token=UUID().uuidString
            inspected=s;ref=token;inspectedAt=ProcessInfo.processInfo.systemUptime
            var result:JSON=["ref":token,"bundleId":s.bundle,"pid":s.pid,"windowId":s.id,
                "windowBounds":encodeRect(s.bounds),"contentBounds":encodeRect(s.content),
                "position":encodePoint(try pointerPosition()),"permissions":permissions()]
            if let url=s.url {result["url"]=url.absoluteString}
            return result
        case "mouseMove","click","drag": break
        default: throw Block("Acción desconocida.")
        }
        guard !readonly || action=="mouseMove" else {throw Block("El ejecutor está en modo de solo lectura.")}
        guard let s=inspected,let token=r["ref"] as? String,ref==token,
              ProcessInfo.processInfo.systemUptime-inspectedAt<45 else {throw Block("Inspecciona de nuevo la ventana activa.")}
        guard let id=r["operationId"] as? String,id.range(of:"^[A-Za-z0-9_-]{1,80}$",options:.regularExpression) != nil,
              !operationIDs.contains(id) else {throw Block("La operación ya fue intentada o no tiene identificador.")}
        let start=try coords(r,"x","y"),end=action=="drag" ? try coords(r,"hastaX","hastaY") : start
        guard action != "drag" || start != end else {throw Block("El arrastre requiere dos puntos distintos.")}
        if CGEventSource.buttonState(.hidSystemState,button:.left) {throw Block("Hay una operación manual con el ratón en curso.")}
        guard s.content.contains(start),s.content.contains(end) else {throw Block("Coordenadas fuera de la ventana.")}
        let steps=action=="drag" ? min(80,max(6,Int(ceil(hypot(end.x-start.x,end.y-start.y)/12)))) : 0
        for i in 0...steps {
            let t=CGFloat(i)/CGFloat(max(1,steps))
            let p=CGPoint(x:start.x+(end.x-start.x)*t,y:start.y+(end.y-start.y)*t)
            try verifyHit(p,s)
        }
        try checked(s,start)
        ref=nil;operationIDs.insert(id)
        try emit(.mouseMoved,point:start)
        if action=="mouseMove" {return ["estado":"movimiento_enviado","operationId":id]}
        var held=false,last=start
        // If focus changes, release to the original process rather than clicking a new app.
        defer {if held {try? emit(.leftMouseUp,point:last,releaseTo:s.pid)}}
        try checked(s,start)
        try emit(.leftMouseDown,point:start);held=true
        if steps>0 {
            for i in 1...steps {
                let t=CGFloat(i)/CGFloat(steps)
                let p=CGPoint(x:start.x+(end.x-start.x)*t,y:start.y+(end.y-start.y)*t)
                let actual=try pointerPosition()
                if hypot(actual.x-last.x,actual.y-last.y)>6 {throw Block("Se detectó movimiento ajeno. Arrastre interrumpido.")}
                try checked(s,p)
                try emit(.leftMouseDragged,point:p)
                last=p
                Thread.sleep(forTimeInterval:0.012)
            }
        }
        try checked(s,end)
        try emit(.leftMouseUp,point:end);held=false
        return ["estado":"gesto_enviado","operationId":id,"verificado":false]
    }
}


/// Main-thread facade for the WKWebView host. Call runSelfTest on the main queue.
final class LumiPointer {
    private let inner: PointerController
    init(model:String, readonly:Bool = true) {
        inner = PointerController(model:model,readonly:readonly,test:false)
    }
    func dispatch(_ request:[String:Any]) throws -> [String:Any] {
        guard Thread.isMainThread else { throw Block("Llama al controlador desde el hilo principal.") }
        let action=request["action"] as? String ?? ""
        guard ["ping","position","close"].contains(action) || inner.model.range(of:"^[A-Za-z0-9]{11}$",options:.regularExpression) != nil else {
            throw Block("Modelo de Matterport inválido.")
        }
        return try inner.handle(request)
    }
    static func runSelfTest(completion:@escaping ([String:Any])->Void) {
        guard Thread.isMainThread else {completion(["ok":false,"message":"Se requiere hilo principal."]);return}
        let controller=PointerController(model:"",readonly:false,test:true)
        guard AXIsProcessTrusted(),CGPreflightPostEventAccess() else {
            completion(["ok":false,"permissions":controller.permissions(),"estado":"sin_permiso","message":"No se enviaron eventos."])
            return
        }
        controller.showTest()
        let modes=["mouseMove","click","drag"]
        func finish(_ result:JSON) {
            controller.testWindow?.close()
            completion(result)
        }
        func step(_ index:Int) {
            if index==modes.count {
                guard let v=controller.testSurface else {finish(["ok":false,"message":"Ventana cerrada."]);return}
                let passed=v.down==2 && v.up==2 && v.drag>0
                finish(["ok":passed,"estado":passed ? "ventana_propia_confirmada":"eventos_sin_confirmar",
                        "down":v.down,"up":v.up,"drag":v.drag,"permissions":controller.permissions()])
                return
            }
            do {
                let mode=modes[index]
                let s=try controller.handle(["action":"inspect"])
                guard let c=s["contentBounds"] as? JSON,let bx=c["x"] as? CGFloat,let by=c["y"] as? CGFloat,let ref=s["ref"] as? String
                else {throw Block("Faltan los límites de la ventana de prueba.")}
                let x=bx+90,y=by+90
                _=try controller.handle(["action":mode,"ref":ref,"x":x,"y":y,"hastaX":x+42,"hastaY":y+16,"operationId":mode])
                // AppKit must return to its own event loop to deliver input to our surface.
                DispatchQueue.main.asyncAfter(deadline:.now()+0.25){step(index+1)}
            } catch {finish(["ok":false,"message":String(describing:error)])}
        }
        DispatchQueue.main.asyncAfter(deadline:.now()+0.8){step(0)}
    }
}
