import os
import json
import uuid
from datetime import datetime

class SessionManager:
    def __init__(self, sessions_dir="saved_sessions"):
        self.sessions_dir = sessions_dir
        if not os.path.exists(self.sessions_dir):
            os.makedirs(self.sessions_dir)

    def _get_filepath(self, filename):
        if not filename.endswith(".json"):
            filename += ".json"
        return os.path.join(self.sessions_dir, filename)

    def save_session(self, filename, groups, preferences=None):
        """
        Saves the current session (groups and preferences).
        Groups structure: List of dicts
        """
        filepath = self._get_filepath(filename)
        data = {
            "timestamp": datetime.now().isoformat(),
            "groups": groups,
            "preferences": preferences or {}
        }
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return filepath

    def load_session(self, filename):
        """Loads a session from a JSON file."""
        filepath = self._get_filepath(filename)
        if not os.path.exists(filepath):
            return None
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)

    def list_sessions(self):
        """Lists all saved session files."""
        return [f for f in os.listdir(self.sessions_dir) if f.endswith(".json")]
