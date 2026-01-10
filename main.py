import webview
import json
import os
import threading
from jwFetcher import NJUCourseClient
from backend.session_manager import SessionManager
from backend.solver import ScheduleSolver
from backend.ranker import ScheduleRanker

def send_toast_global(msg, type='info'):
    """Standalone callback for backend components to send toasts"""
    try:
        if len(webview.windows) > 0:
            window = webview.windows[0]
            # Use json.dumps to safely serialize the message (handles quotes, newlines, etc.)
            import json
            safe_msg = json.dumps(msg)
            safe_type = json.dumps(type)
            # safe_msg already includes quotes, e.g. "Hello"
            window.evaluate_js(f"showToast({safe_msg}, {safe_type})")
    except Exception as e:
        print(f"[Api] Failed to send toast: {e}")

class Api:
    def __init__(self):
        # Pass standalone function to break circular reference Api -> Client -> Api.method
        self.client = NJUCourseClient(toast_callback=send_toast_global)
        self.session_manager = SessionManager()

    def send_toast_safe(self, msg, type='info'):
        """Callback for backend components to send toasts"""
        send_toast_global(msg, type)

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
        raw_schedules, total_count = ScheduleSolver.generate_schedules(groups, preferences=preferences)
        print(f"[Api] Found {len(raw_schedules)} top schedules (from {total_count} total explored)")

        # 3. Rank and Enrich
        ranker = ScheduleRanker()
        ranked = []
        for s in raw_schedules:
            eval_result = ranker.evaluate_schedule(s, preferences)
            score = eval_result['score']
            details = eval_result['details']

            # Calculate stats
            total_credits = 0.0
            total_hours = 0

            # Find week span
            min_week = 999
            max_week = -1
            has_classes = False

            for course in s:
                total_credits += course.get('credit', 0)

                # Track active weeks for this course
                course_weeks = set()

                # Try getting from sessions first
                sessions = course.get('sessions', [])
                if sessions:
                    for sess in sessions:
                        if sess['weeks']:
                            course_weeks.update(sess['weeks'])
                else:
                    # Fallback: scan schedule_bitmaps
                    # index 1..len
                    bitmaps = course.get('schedule_bitmaps', [])
                    for w_idx in range(1, len(bitmaps)):
                        val = bitmaps[w_idx]
                        if isinstance(val, str):
                            try:
                                val = int(val)
                            except: val = 0
                        if val > 0:
                            course_weeks.add(w_idx)

                # Update global stats
                if course_weeks:
                    has_classes = True
                    min_week = min(min_week, min(course_weeks))
                    max_week = max(max_week, max(course_weeks))

                # Use official hours if available, else calculate
                if course.get('hours', 0) > 0:
                    total_hours += course.get('hours')
                else:
                    # Calculate hours from sessions if available
                    if sessions:
                        for sess in sessions:
                            p_len = sess['end'] - sess['start'] + 1
                            w_len = len(sess['weeks'])
                            total_hours += (p_len * w_len)
                    else:
                        # Fallback: Count bits in bitmaps for active weeks
                        bitmaps = course.get('schedule_bitmaps', [])
                        for w in course_weeks:
                            if w < len(bitmaps):
                                val = bitmaps[w]
                                if isinstance(val, str):
                                    val = int(val)
                                total_hours += bin(val).count('1')

            avg_weekly = 0.0
            if has_classes and max_week >= min_week:
                span = max_week - min_week + 1
                if span > 0:
                    avg_weekly = total_hours / span

            ranked.append({
                'courses': s,
                'score': score,
                'score_details': details,
                'stats': {
                    'total_credits': round(total_credits, 1),
                    'total_hours': total_hours,
                    'avg_weekly_hours': round(avg_weekly, 1),
                    'week_span': f"{min_week}-{max_week}" if has_classes else "N/A"
                }
            })

        # Sort desc
        ranked.sort(key=lambda x: x['score'], reverse=True)

        return {'schedules': ranked, 'total_found': total_count}

    def save_image_dialog(self, base64_data):
        import base64
        try:
            active_window = webview.windows[0]
            file_path = active_window.create_file_dialog(
                webview.SAVE_DIALOG,
                directory='',
                save_filename='schedule.png',
                file_types=('PNG Image (*.png)', 'All files (*.*)')
            )

            if file_path:
                if isinstance(file_path, (list, tuple)):
                    file_path = file_path[0]

                # Remove header if present
                if ',' in base64_data:
                    base64_data = base64_data.split(',')[1]

                with open(file_path, "wb") as f:
                    f.write(base64.b64decode(base64_data))
                return True
            return False
        except Exception as e:
            print(f"[Api] Save Image Error: {e}")
            return False

    def save_session(self, groups_json, prefs_json):
        try:
            groups = json.loads(groups_json)
            prefs = json.loads(prefs_json)
            path = self.session_manager.save_session("last_session", groups, prefs)
            print(f"[Api] Saved to {path}")
            self.send_toast_safe("会话保存成功", "success")
            return True
        except Exception as e:
            print(f"[Api] Save Error: {e}")
            self.send_toast_safe(f"保存失败: {e}", "error")
            return False
        
    def load_session(self, filename="last_session"):
        try:
            data = self.session_manager.load_session(filename)
            if data:
                print(f"[Api] Loaded session with {len(data.get('groups', []))} groups")
                # self.send_toast_safe(f"已恢复上次会话 ({len(data.get('groups', []))} 组)", "info")
            return data
        except Exception as e:
            print(f"[Api] Load Error: {e}")
            self.send_toast_safe(f"加载会话失败: {e}", "error")
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
