from playwright.sync_api import sync_playwright

def verify_missing_courses_display(page):
    page.on("console", lambda msg: print(f"Browser Console: {msg.text}"))
    page.goto("http://localhost:8080")

    # Mock Search
    # Group A: 2 Options. Mon 1-2 (conflicts with B), Tue 1-2 (conflicts with C)
    page.route("**/search?*name=A*", lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body='[' +
             '{"name": "A", "code": "001", "teacher": "T1a", "location_text": "Mon 1-2", "checked": false, "schedule_bitmaps": ["3","3"]},' +
             '{"name": "A", "code": "001", "teacher": "T1b", "location_text": "Tue 1-2", "checked": false, "schedule_bitmaps": ["12","12"]}' +
             ']'
    ))
    # Group B: Mon 1-2 (conflicts with A1)
    page.route("**/search?*name=B*", lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body='[{"name": "B", "code": "002", "teacher": "T2", "location_text": "Mon 1-2", "checked": false, "schedule_bitmaps": ["3","3"]}]'
    ))
    # Group C: Tue 1-2 (conflicts with A2)
    page.route("**/search?*name=C*", lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body='[{"name": "C", "code": "003", "teacher": "T3", "location_text": "Tue 1-2", "checked": false, "schedule_bitmaps": ["12","12"]}]'
    ))

    # Add A (Both options)
    page.fill('input[placeholder*="课程名"]', 'A')
    page.click("button:has-text('搜索')")
    page.wait_for_selector("text=结果 (2)")
    # Select all
    page.click("text=全选/反选")
    page.click("button:has-text('将选中项存为一组')")

    # Add B
    page.fill('input[placeholder*="课程名"]', 'B')
    page.click("button:has-text('搜索')")
    page.wait_for_selector("text=结果 (1)")
    page.click("input[type='checkbox']")
    page.click("button:has-text('将选中项存为一组')")

    # Add C
    page.fill('input[placeholder*="课程名"]', 'C')
    page.click("button:has-text('搜索')")
    page.wait_for_selector("text=结果 (1)")
    page.click("input[type='checkbox']")
    page.click("button:has-text('将选中项存为一组')")

    # Go to Planning
    page.click("text=2. 规划 & 策略")
    page.wait_for_selector("text=我的课程组 (3)")

    # Generate
    print("Clicking Generate...")
    page.click("button:has-text('生成课表方案')")

    # Check for toast
    try:
        toast = page.wait_for_selector(".toast", state="visible", timeout=2000)
        if toast:
            print(f"Toast detected: {toast.inner_text()}")
    except:
        pass

    # Wait for result
    try:
        page.wait_for_selector("text=推荐方案", timeout=5000)
        print("Results generated successfully.")
    except:
        print("Failed to reach results view.")
        page.screenshot(path="verification/spa_failed.png")
        return

    # Check warning
    # We expect some course to be missing (either A, B, or C)
    warning_locator = page.locator("text=未排课程 (冲突):")
    if warning_locator.is_visible():
        print("PASS: Warning is visible")
        print(warning_locator.text_content())
    else:
        print("FAIL: Warning not found")

    page.screenshot(path="verification/spa_missing_courses.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_missing_courses_display(page)
        finally:
            browser.close()
