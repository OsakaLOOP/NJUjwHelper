from playwright.sync_api import sync_playwright

def verify_frontend():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Access the index.html directly from the static server
        page.goto("http://localhost:8080/static/index.html")
        page.wait_for_load_state("networkidle")

        # 1. Verify Privacy Text is present
        # Check all spans in h1
        spans = page.locator("header h1 span")
        count = spans.count()
        print(f"Found {count} spans in header.")

        privacy_found = False
        for i in range(count):
            txt = spans.nth(i).inner_text()
            print(f"Span {i}: {txt}")
            if "本app所有内容在本地处理" in txt:
                privacy_found = True

        if privacy_found:
            print("[SUCCESS] Privacy text found.")
        else:
            print("[FAIL] Privacy text not found.")

        # 2. Trigger Mock Flow to get to Results
        # Search
        page.get_by_role("button", name="搜索").click()
        page.wait_for_timeout(500)

        # Select first result
        page.locator(".result-item input[type='checkbox']").first.click()

        # Create Group
        page.get_by_text("将选中项存为一组").click()

        # Go to Planning
        page.get_by_text("2. 规划 & 策略").click()

        # Generate
        page.get_by_role("button", name="生成课表方案").click()
        page.wait_for_timeout(500)

        # Check Stats Section
        # It's inside #capture-area
        # Look for "总学分"
        if page.get_by_text("总学分: 22.5").is_visible():
             print("[SUCCESS] Stats displayed correctly.")
        else:
             print("[FAIL] Stats not found.")
             # Debug content
             print(page.locator("#capture-area").inner_text())

        # Check scrollable container
        # We need 20 schedules to test scroll?
        # Mock only returns 1.
        # But we can verify the CSS class or style.
        # The container is the parent of the scheme buttons.

        # Take screenshot
        page.screenshot(path="verification/verification.png")
        print("Screenshot saved.")

        browser.close()

if __name__ == "__main__":
    verify_frontend()
