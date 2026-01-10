from playwright.sync_api import sync_playwright, expect
import time
import subprocess
import sys
import os

def verify_frontend():
    # Start the server in background
    # We use the python script we created earlier
    server_process = subprocess.Popen([sys.executable, "verification/server.py"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()

            # 1. Navigate to Search View
            page.goto("http://localhost:8000/index.html")

            # Wait for Vue to mount
            page.wait_for_selector("#app")

            # Verify "Batch Import" button exists on the first page (Search View)
            import_btn = page.get_by_role("button", name="批量导入")
            expect(import_btn).to_be_visible()

            # Take a screenshot of the search page
            page.screenshot(path="verification/search_view.png")
            print("Captured search_view.png")

            # 2. Perform a search
            name_input = page.get_by_placeholder("课程名 (空格分隔多词)")
            name_input.fill("数学")

            search_btn = page.get_by_role("button", name="搜索")
            search_btn.click()

            # Wait for results
            page.wait_for_selector(".result-item")

            # Take a screenshot of results
            page.screenshot(path="verification/search_results.png")
            print("Captured search_results.png")

            # 3. Create a Group
            # Click "Select All"
            select_all_btn = page.get_by_text("全选/反选")
            select_all_btn.click()

            # Click "Save as Group"
            create_group_btn = page.get_by_text("将选中项存为一组")
            create_group_btn.click()

            # Verify Toast
            # toast = page.locator(".toast.success")
            # expect(toast).to_be_visible()

            # 4. Go to Planning View
            plan_tab = page.get_by_text("2. 规划 & 策略")
            plan_tab.click()

            # Take a screenshot of planning view
            page.screenshot(path="verification/planning_view.png")
            print("Captured planning_view.png")

            # 5. Generate Schedule
            generate_btn = page.get_by_text("生成课表方案")
            generate_btn.click()

            # Wait for results tab
            page.wait_for_selector("table.timetable")

            # Screenshot timetable
            page.screenshot(path="verification/timetable_view.png")
            print("Captured timetable_view.png")

            browser.close()

    finally:
        server_process.terminate()

if __name__ == "__main__":
    verify_frontend()
