from playwright.sync_api import sync_playwright

def verify_frontend():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Access the index.html directly from the static server
        page.goto("http://localhost:8080/static/index.html")

        # 1. Verify Privacy Text is present
        # It's in the header h1 span with specific text
        privacy_text = page.locator("header h1 span").nth(1)
        if privacy_text.is_visible() and "本app所有内容在本地处理" in privacy_text.inner_text():
            print("[SUCCESS] Privacy text found.")
        else:
            print("[FAIL] Privacy text not found or incorrect.")

        # 2. Verify Stats Display logic
        # We need to simulate having schedules.
        # Inject mock data into the Vue app
        page.evaluate("""
            const app = document.getElementById('app').__vue_app__._instance;
            app.setupState.schedules = [
                {
                    score: 95,
                    score_details: {'早八回避': -2, '课程紧凑': 5},
                    stats: {
                        'total_credits': 22.5,
                        'total_hours': 400,
                        'avg_weekly_hours': 25.0,
                        'week_span': '1-16'
                    },
                    courses: []
                },
                { score: 90, courses: [] }
            ];
            app.setupState.currentView = 'results';
            app.setupState.currentScheduleIdx = 0;
        """)

        # Wait for render
        page.wait_for_timeout(500)

        # Check Stats Section
        stats_section = page.locator("#capture-area div").first
        content = stats_section.inner_text()
        print(f"Stats Content: {content}")

        if "总学分: 22.5" in content and "早八回避: -2" in content:
            print("[SUCCESS] Stats and score details displayed.")
        else:
            print("[FAIL] Stats incorrect.")

        # 3. Verify Schedule Buttons container styles
        # Check if flex-shrink: 0 is applied to buttons
        # We can check CSS property
        buttons_container = page.locator(".card .secondary").first.locator("..") # parent div
        # Actually checking if buttons have flex-shrink: 0
        btn = page.locator(".card button").nth(0) # First scheme button?
        # The scheme buttons are inside a div with overflow-x: auto
        # Selector: div with padding-bottom: 10px > button
        scheme_btn = page.locator("button", has_text="方案 1")

        # Take screenshot
        page.screenshot(path="verification/verification.png")
        print("Screenshot saved.")

        browser.close()

if __name__ == "__main__":
    verify_frontend()
