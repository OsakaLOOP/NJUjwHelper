from playwright.sync_api import sync_playwright, expect
import os

def verify_frontend():
    print("Starting Frontend Verification...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # 1. Load Page
        page.goto("http://localhost:8080/static/index.html")
        expect(page.get_by_role("heading", name="NJU 选课助手")).to_be_visible()
        print("Page loaded.")

        # 2. Test Search (Mock)
        page.get_by_placeholder("课程名").fill("Test")
        page.get_by_role("button", name="搜索").click()

        # Wait for results (mock delay 500ms)
        page.wait_for_timeout(1000)
        expect(page.get_by_text("搜索结果")).to_be_visible()
        print("Search results visible.")

        # 3. Create Group
        page.get_by_role("button", name="将选中项存为一组").click()
        expect(page.get_by_text("我的课程组")).to_be_visible()
        print("Group created.")

        # 4. Generate Schedule
        page.get_by_role("button", name="生成课表方案").click()
        page.wait_for_timeout(500)
        expect(page.get_by_text("推荐方案")).to_be_visible()
        print("Schedules generated.")

        # 5. Screenshot
        screenshot_path = "verification/frontend_verify.png"
        page.screenshot(path=screenshot_path)
        print(f"Screenshot saved to {screenshot_path}")

        browser.close()

if __name__ == "__main__":
    verify_frontend()
