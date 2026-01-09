from backend.cookie_manager import CookieManager
from backend.session_manager import SessionManager
import os
import json

def test_persistence():
    print("[*] Testing Persistence...")

    # 1. Cookie
    cm = CookieManager("tests/test_cookies.txt")
    dummy_cookie = "TEST=123; SESSION=ABC"
    cm.save_cookie(dummy_cookie)
    loaded = cm.load_cookie()
    assert loaded == dummy_cookie, f"Cookie Mismatch: {loaded} != {dummy_cookie}"
    print("    [+] Cookie Manager OK")

    # 2. Session
    sm = SessionManager("tests/saved_sessions")
    dummy_groups = [{"id": 1, "courses": []}]
    prefs = {"avoid_early": True}

    path = sm.save_session("test_session", dummy_groups, prefs)
    assert os.path.exists(path), "Session file not created"

    loaded_session = sm.load_session("test_session")
    assert loaded_session["groups"] == dummy_groups, "Groups mismatch"
    assert loaded_session["preferences"] == prefs, "Preferences mismatch"

    print("    [+] Session Manager OK")

if __name__ == "__main__":
    test_persistence()
