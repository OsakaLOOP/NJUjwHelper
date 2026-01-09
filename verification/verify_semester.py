from playwright.sync_api import sync_playwright, expect

def verify_semester_input():
    print("Verifying Semester Input...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("http://localhost:8080/static/index.html")

        # Check for the semester input
        # It has placeholder "学期 (如 2025-2026-1)"
        sem_input = page.get_by_placeholder("学期 (如 2025-2026-1)")
        expect(sem_input).to_be_visible()
        expect(sem_input).to_have_value("2025-2026-1") # Default value from app.js

        print("Semester input found and has default value.")

        sem_input.fill("2025-2026-2")
        expect(sem_input).to_have_value("2025-2026-2")

        print("Semester input interaction working.")

        page.screenshot(path="verification/semester_verify.png")
        print("Screenshot saved.")

        browser.close()

if __name__ == "__main__":
    verify_semester_input()
