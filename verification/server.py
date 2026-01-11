import http.server
import socketserver
import json
import urllib.parse
import os

PORT = 8000
DIRECTORY = "dist"

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/search":
            query = urllib.parse.parse_qs(parsed.query)
            # Dummy response for search
            data = []
            for i in range(20):
                data.append({
                    "name": f"Course {i}",
                    "code": f"CODE{i}",
                    "teacher": f"Teacher {i}",
                    "location_text": f"Loc {i}",
                    "sessions": [],
                    "alternatives": []
                })

            self.send_response(200)
            self.send_header("Content-type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(data).encode())
            return

        return super().do_GET()

if __name__ == "__main__":
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"Serving at port {PORT}")
        httpd.serve_forever()
