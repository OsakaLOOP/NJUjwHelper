import webview
import json
import os
import threading
from jwFetcher import NJUCourseClient
from backend.session_manager import SessionManager
from backend.solver import ScheduleSolver
from backend.ranker import ScheduleRanker

class Api:
    def __init__(self):
        self.client = NJUCourseClient() # Auto loads cookie
        self.session_manager = SessionManager()

    def search(self, params):
        """
        params: dict {name, code, campus}
        """
        print(f"[Api] Search: {params}")
        # Map params to client args
        # search(self, course_name=None, course_code=None, campus="1", semester="2025-2026-1")
        # Default semester hardcoded in client, could expose later
        try:
            results = self.client.search(
                course_name=params.get('name'),
                course_code=params.get('code'),
                campus=params.get('campus', '1'),
                semester=params.get('semester', '2025-2026-1'),
                match_mode=params.get('match_mode', 'OR')
            )
            return results
        except Exception as e:
            print(f"[Api] Search Error: {e}")
            raise e

    def generate_schedules(self, groups, preferences):
        """
        groups: List of group objects
        preferences: dict
        """
        print("[Api] Generating Schedules...")

        # 1. Check Conflicts
        conflicts = ScheduleSolver.check_conflicts(groups)
        if conflicts:
            conflict_msg = []
            for item in conflicts:
                # item is (i, j, reason)
                i, j = item[0], item[1]
                reason = item[2] if len(item) > 2 else "Unknown"

                name1 = groups[i]['candidates'][0]['name'] if groups[i]['candidates'] else f"Group {i+1}"
                name2 = groups[j]['candidates'][0]['name'] if groups[j]['candidates'] else f"Group {j+1}"
                conflict_msg.append(f"{name1} 与 {name2} 冲突 ({reason})")
            return {'error': " | ".join(conflict_msg)}

        # 2. Generate
        # Pass preferences to solver for DFS pruning/ordering
        raw_schedules = ScheduleSolver.generate_schedules(groups, preferences=preferences)
        print(f"[Api] Found {len(raw_schedules)} valid schedules")

        # 3. Rank
        ranker = ScheduleRanker()
        ranked = []
        for s in raw_schedules:
            score = ranker.score_schedule(s, preferences)
            ranked.append({'courses': s, 'score': score})

        # Sort desc
        ranked.sort(key=lambda x: x['score'], reverse=True)

        return {'schedules': ranked}

    def save_session(self, groups_json, prefs_json):
        try:
            groups = json.loads(groups_json)
            prefs = json.loads(prefs_json)
            path = self.session_manager.save_session("last_session", groups, prefs)
            print(f"[Api] Saved to {path}")
            return True
        except Exception as e:
            print(f"[Api] Save Error: {e}")
            return False
        
    def load_session(self, filename="last_session"):
        try:
            data = self.session_manager.load_session(filename)
            if data:
                print(f"[Api] Loaded session with {len(data.get('groups', []))} groups")
            return data
        except Exception as e:
            print(f"[Api] Load Error: {e}")
            return None

if __name__ == "__main__":
    api = Api()

    # Path to index.html
    # In production/freeze, sys._MEIPASS might be needed, but for script run:
    html_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static/index.html')

    window = webview.create_window(
        '🐋南哪选课助手',
        url=html_path,
        js_api=api,
        width=1200, height=800
    )
    webview.start(debug=False)
