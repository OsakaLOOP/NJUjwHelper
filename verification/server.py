import http.server
import socketserver
import json
import urllib.parse
import os
import sys

PORT = 8000
DIRECTORY = "dist"

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # Mock Edge Function
        if path.startswith("/functions/search"):
            self.handle_search(parsed.query)
            return

        return super().do_GET()

    def handle_search(self, query_string):
        params = urllib.parse.parse_qs(query_string)
        campus = params.get('campus', ['1'])[0]
        semester = params.get('semester', ['2025-2026-1'])[0]

        # Load JSON data
        # Note: In real edge, this is globalThis[key] or fetch
        filename = f"nju_courses_{campus}_{semester}.json"
        filepath = os.path.join(DIRECTORY, "data", filename)

        if not os.path.exists(filepath):
            self.send_error(404, "Data file not found")
            return

        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception as e:
            self.send_error(500, f"Error reading data: {e}")
            return

        # Filter Logic
        name_param = params.get('name', [''])[0].lower().strip()
        code_param = params.get('code', [''])[0].lower().strip()
        match_mode = params.get('match_mode', ['OR'])[0]

        results = []
        for item in data:
            # Name Filter
            if name_param:
                keywords = name_param.split()
                item_name = (item.get('name') or '').lower()

                if match_mode == 'AND':
                    if not all(k in item_name for k in keywords):
                        continue
                else: # OR
                    if not any(k in item_name for k in keywords):
                        continue

            # Code Filter
            if code_param:
                if code_param not in (item.get('code') or '').lower():
                    continue

            results.append(item)

        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(results).encode('utf-8'))

if __name__ == "__main__":
    # Ensure dist exists
    if not os.path.exists(DIRECTORY):
        print(f"Error: {DIRECTORY} directory not found.")
        sys.exit(1)

    print(f"Serving {DIRECTORY} at http://localhost:{PORT}")
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server.")
