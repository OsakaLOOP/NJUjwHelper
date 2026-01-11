from playwright.sync_api import sync_playwright, expect
import re

def test_interaction(page):
    page.goto("http://localhost:8000")

    # Wait for page to load
    page.wait_for_selector(".search-grid")

    # 1. Perform Search
    page.click("button:text('搜索')")

    # Wait for results
    page.wait_for_selector(".result-item")
    items = page.locator(".result-item")
    expect(items).to_have_count(20)

    # 2. Test Shift+Click
    # Click item 0 (check it)
    items.nth(0).click()
    expect(items.nth(0).locator("input")).to_be_checked()

    # Shift+Click item 4 (should check 0-4)
    items.nth(4).click(modifiers=["Shift"])

    expect(items.nth(1).locator("input")).to_be_checked()
    expect(items.nth(2).locator("input")).to_be_checked()
    expect(items.nth(3).locator("input")).to_be_checked()
    expect(items.nth(4).locator("input")).to_be_checked()

    print("Shift+Click test passed")

    # 3. Test Touch/Drag Logic
    # Reset page state
    page.reload()
    page.click("button:text('搜索')")
    page.wait_for_selector(".result-item")

    # Dispatch TouchStart via JS manually to avoid browser context issues
    print("Simulating Touch Start via JS...")
    page.evaluate("""(index) => {
        const el = document.querySelectorAll('.result-item')[index];
        const touch = new Touch({
            identifier: 0,
            target: el,
            clientX: 100,
            clientY: 100
        });
        const event = new TouchEvent('touchstart', {
            touches: [touch],
            targetTouches: [touch],
            changedTouches: [touch],
            bubbles: true,
            cancelable: true
        });
        el.dispatchEvent(event);
    }""", 2)

    # Wait for 600ms (threshold is 500ms)
    page.wait_for_timeout(600)

    # Check if class is applied.
    # Note: 'drag-selecting' is applied conditionally in Vue template:
    # :class="['result-item', (touchState.dragging && ...) ? 'drag-selecting' : '']"
    # So if state changed, class should appear.
    expect(items.nth(2)).to_have_class(re.compile(r"drag-selecting"))
    print("Long press triggered class change")

    # Check that item 2 got selected/toggled
    expect(items.nth(2).locator("input")).to_be_checked()

    # Verify Sticky Header
    header = page.locator("header")
    expect(header).to_have_css("position", "sticky")
    expect(header).to_have_css("top", "0px")
    print("Sticky header verified")

    # Take screenshot
    page.screenshot(path="verification/interaction_test.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        # Launch with arguments if necessary, but plain launch usually works if we don't use page.touchscreen APIs directly
        browser = p.chromium.launch()
        # Create context with has_touch=True if we want to rely on browser capabilities,
        # but here we dispatch events manually.
        page = browser.new_page()
        try:
            test_interaction(page)
        except Exception as e:
            print(f"Test failed: {e}")
            # Take screenshot on failure
            try:
                page.screenshot(path="verification/failure.png")
            except:
                pass
        finally:
            browser.close()
