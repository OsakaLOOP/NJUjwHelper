import os
import json
import time

class CookieManager:
    def __init__(self, filepath="cookies.txt"):
        self.filepath = filepath

    def save_cookie(self, cookie_str):
        """Saves the cookie string to a file."""
        if not cookie_str:
            return
        with open(self.filepath, "w", encoding="utf-8") as f:
            f.write(cookie_str)

    def load_cookie(self):
        """Loads the cookie string from the file."""
        if not os.path.exists(self.filepath):
            return None
        with open(self.filepath, "r", encoding="utf-8") as f:
            return f.read().strip()

    def clear_cookie(self):
        """Removes the cookie file."""
        if os.path.exists(self.filepath):
            os.remove(self.filepath)
