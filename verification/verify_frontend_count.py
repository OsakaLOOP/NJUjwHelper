from playwright.sync_api import sync_playwright

def verify_frontend_count():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Access the index.html directly from the static server
        page.goto("http://localhost:8080/static/index.html")
        page.wait_for_load_state("networkidle")

        # Inject mock data with total_found
        page.evaluate("""
            const app = document.getElementById('app').__vue_app__._instance;
            app.setupState.schedules = [
                {
                    score: 95,
                    score_details: {},
                    stats: {},
                    courses: []
                }
            ];
            app.setupState.totalCount = 1234;
            app.setupState.currentView = 'results';
        """)

        page.wait_for_timeout(500)

        # Check Header
        # Selector: h3 in .card containing "推荐方案"
        header = page.get_by_text("推荐方案 (显示 1 个 / 共 1234 个可能方案)")

        if header.is_visible():
            print("[SUCCESS] Total count displayed in header.")
        else:
            print("[FAIL] Header text not found.")
            # debug
            print(page.locator(".card h3").inner_text())

        page.screenshot(path="verification/verification_count.png")
        print("Screenshot saved.")

        browser.close()

if __name__ == "__main__":
    verify_frontend_count()
