"""Local desktop commands from the installed Workspace web app."""
import json
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ORIGIN = 'https://dilsar32-ops.github.io'
EXEC = Path.home() / 'Applications/LumiMouse.app/Contents/MacOS/LumiMouse'

class Handler(BaseHTTPRequestHandler):
    def authorized(self):
        return (self.path == '/pointer' and self.headers.get('Host') == '127.0.0.1:49183'
                and self.headers.get('Origin') == ORIGIN)

    def reply(self, status, message=''):
        body = json.dumps({'message': message}).encode()
        self.send_response(status)
        if self.authorized():
            self.send_header('Access-Control-Allow-Origin', ORIGIN)
            self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.reply(200 if self.authorized() else 403)

    def do_POST(self):
        ref = urlsplit(self.headers.get('Referer',''))
        if (not self.authorized() or ref.scheme+'://'+ref.netloc != ORIGIN
                or not ref.path.startswith('/amg-reportes/') or self.headers.get('Content-Type') != 'application/json'):
            return self.reply(403)
        try:
            length = int(self.headers.get('Content-Length', 0))
            if not 0 < length <= 1024:
                return self.reply(400)
            data = json.loads(self.rfile.read(length))
            action, name = data['action'], data['app']
            if action not in ('open','point','click','digit') or not isinstance(name,str) or not 0 < len(name) <= 100:
                return self.reply(400)
            args = [str(EXEC), action, name]
            if action == 'digit':
                digit = data.get('digit')
                if name != 'Calculadora' or not isinstance(digit,str) or digit not in tuple('0123456789'):
                    return self.reply(400)
                args = [str(Path(__file__).with_name('named-key')), digit]
            elif action != 'open':
                for key in ('x','y'):
                    if type(data[key]) is not int or abs(data[key]) > 65535:
                        return self.reply(400)
                    args.append(str(data[key]))
            result = subprocess.run(args, capture_output=True, text=True, timeout=8)
            self.reply(200 if result.returncode == 0 else 409, (result.stdout or result.stderr).strip())
        except (ValueError,KeyError,TypeError,subprocess.SubprocessError,OSError):
            self.reply(400, 'No se pudo ejecutar la orden.')
HTTPServer(('127.0.0.1',49183), Handler).serve_forever()
