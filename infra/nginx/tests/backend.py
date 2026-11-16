import http.server, json, sys
PORT=int(sys.argv[1]); NAME=sys.argv[2]
class H(http.server.BaseHTTPRequestHandler):
    def _h(self):
        n=int(self.headers.get('Content-Length') or 0)
        if n: self.rfile.read(n)
        info={"svc":NAME,"method":self.command,"path":self.path,
              "x_user_id":self.headers.get('X-User-Id'),
              "x_user_role":self.headers.get('X-User-Role'),
              "x_request_id":self.headers.get('X-Request-Id')}
        with open(f"/tmp/gwtest/hits-{NAME}.log","a") as f: f.write(json.dumps(info)+"\n")
        body=json.dumps(info).encode()
        self.send_response(200); self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
    do_GET=do_POST=do_PUT=do_DELETE=_h
    def log_message(self,*a): pass
http.server.ThreadingHTTPServer(('127.0.0.1',PORT),H).serve_forever()
