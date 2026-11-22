import Foundation
import AppKit
import ApplicationServices
func respond(_ object:JSON) {
    do {
        let bytes=try JSONSerialization.data(withJSONObject:object)
        FileHandle.standardOutput.write(bytes)
        FileHandle.standardOutput.write(Data([10]))
    } catch {FileHandle.standardOutput.write(Data("{\"ok\":false,\"message\":\"No se pudo codificar la respuesta\"}\n".utf8))}
}

let args=CommandLine.arguments
let test=args.contains("--test") || args.contains("--self-test")
let readOnly=args.contains("--readonly")
func argument(_ name:String)->String? {
    guard let pos=args.firstIndex(of:name),pos+1<args.count else{return nil}
    return args[pos+1]
}
let model=argument("--model") ?? ""
if !test && (model.range(of:"^[A-Za-z0-9]{11}$",options:.regularExpression)==nil ||
    (argument("--project") ?? "").range(of:"^[0-9]+$",options:.regularExpression)==nil) {
    respond(["ok":false,"message":"Indica --project ID --model ID, o --test para la ventana propia."])
    exit(2)
}
let controller=PointerController(model:model,readonly:readOnly,test:test)
if args.contains("--self-test") {
    let permissions=controller.permissions()
    guard AXIsProcessTrusted(),CGPreflightPostEventAccess() else {
        respond(["ok":false,"permissions":permissions,"estado":"sin_permiso","message":"Prueba real omitida; no se enviaron eventos."])
        exit(3)
    }
}
let app=NSApplication.shared
app.setActivationPolicy(test ? .regular : .prohibited)
if test && !args.contains("--self-test") && AXIsProcessTrusted() && CGPreflightPostEventAccess(){controller.showTest()}
if args.contains("--self-test") {
    LumiPointer.runSelfTest { result in
        respond(result)
        exit(result["ok"] as? Bool == true ? 0 : 1)
    }
} else {
    DispatchQueue.global().async {
        while let line=readLine(){
            DispatchQueue.main.sync {
                var result:JSON=[:]
                do {
                    guard let data=line.data(using:.utf8),let req=try JSONSerialization.jsonObject(with:data) as? JSON else {
                        throw Block("Se esperaba JSON.")
                    }
                    if let id=req["id"] {result["id"]=id}
                    result.merge(try controller.handle(req)){_,new in new}
                    result["ok"]=true
                    respond(result)
                    if req["action"] as? String=="close"{exit(0)}
                } catch {result["ok"]=false;result["message"]=String(describing:error);respond(result)}
            }
        }
        DispatchQueue.main.async{exit(0)}
    }
}
app.run()
