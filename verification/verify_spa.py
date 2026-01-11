
from playwright.sync_api import sync_playwright, expect
import json
import time

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()

    # Mock Search Results
    mock_courses = [
        {
            "name": "Course A",
            "code": "1001",
            "teacher": "Teacher A",
            "location_text": "周一 1-2 (仙II-101)",
            "schedule_bitmaps": ["0", "3", "3", "3"], # Week 1-3, Day 1 Node 1-2 (Bits 0,1) -> 3
            "sessions": [{"weeks": [1,2,3], "day": 0, "start": 1, "end": 2, "location": "仙II-101"}],
            "credit": 2,
            "hours": 32
        },
        {
            "name": "Course B",
            "code": "1002",
            "teacher": "Teacher B",
            "location_text": "周二 9-10 (仙II-102)",
            "schedule_bitmaps": ["0", "786432", "786432", "786432"], # Week 1-3, Day 2 Node 9-10. Bits: 13+8=21, 13+9=22. 2^21 | 2^22.
            "sessions": [{"weeks": [1,2,3], "day": 1, "start": 9, "end": 10, "location": "仙II-102"}],
            "credit": 2,
            "hours": 32
        }
    ]

    # Bits calculation for Course B:
    # Day 2 is index 1.
    # Node 9 is index 8. 1*13 + 8 = 21.
    # Node 10 is index 9. 1*13 + 9 = 22.
    # 2^21 = 2097152
    # 2^22 = 4194304
    # Sum = 6291456
    # Wait, my mock above "786432" seems wrong calculation.
    # Let's use JS to calculate in runtime or just rely on sessions if solver uses sessions.
    # Solver uses sessions for stats, but uses bitmaps for conflict/ranking.
    # I should provide correct bitmaps.
    # 2^21 + 2^22 = 6291456.

    mock_courses[1]["schedule_bitmaps"] = ["0", "6291456", "6291456", "6291456"]


    # Mock /search endpoint
    page.route("**/search*", lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps(mock_courses)
    ))

    # 1. Load Page
    page.goto("http://localhost:8000")
    expect(page.locator("h1")).to_contain_text("南哪选课助手")

    # 2. Search
    page.locator("input[placeholder*='课程名']").fill("Course")
    page.get_by_text("搜索", exact=True).click()

    # Wait for results
    expect(page.get_by_text("搜索结果 (2)")).to_be_visible()

    # 3. Create Group
    # Select all
    page.get_by_text("全选/反选").click()
    page.get_by_text("将选中项存为一组").click()
    expect(page.get_by_text("已添加新课程组")).to_be_visible()

    # 4. Switch to Planning
    page.get_by_text("2. 规划 & 策略").click()

    # Check new "Skippable" checkbox existence
    skippable_checkbox = page.locator(".group-header input[type='checkbox']")
    expect(skippable_checkbox).to_be_visible()

    # Check new "Quality Sleep" preference
    sleep_pref = page.get_by_text("优质睡眠 (9-13节)")
    expect(sleep_pref).to_be_visible()

    # 5. Enable Skippable for Group 1 (Course A & B are in one group because we selected both and clicked create once)
    # Wait, "createGroup" creates ONE group with all selected candidates.
    # So Group 1 contains Course A and Course B as candidates for the SAME slot?
    # No, typically user selects one course's candidates.
    # But if I select Course A and Course B, they become candidates for Group 1.
    # This means I can choose A OR B.
    # Let's say I want both. I should have added them separately.
    # But for this test, let's assume they are alternatives.
    # Solver will pick ONE.

    # Let's delete this group and add them separately for better visual.
    page.get_by_text("删除").click()

    # Go back to Search
    page.get_by_text("1. 课程查询").click()

    # Select only Course A
    page.get_by_text("全选/反选").click() # Unselect all

    # Find checkbox for Course A.
    # result-item
    rows = page.locator(".result-item")
    rows.nth(0).locator("input[type='checkbox']").check()
    page.get_by_text("将选中项存为一组").click()

    # Uncheck A, Check B
    rows.nth(0).locator("input[type='checkbox']").uncheck()
    rows.nth(1).locator("input[type='checkbox']").check()
    page.get_by_text("将选中项存为一组").click()

    # Go to Planning
    page.get_by_text("2. 规划 & 策略").click()
    expect(page.get_by_text("我的课程组 (2)")).to_be_visible()

    # 6. Mark Course B (Group 2) as Skippable
    # Group 2 is the second one.
    # Locator for group items
    groups = page.locator(".group-item")
    group2_skippable = groups.nth(1).locator(".group-header input[type='checkbox']")
    group2_skippable.check()

    # 7. Generate Schedule
    page.get_by_text("生成课表方案").click()

    # 8. Check Results
    # Should automatically switch to Results view
    expect(page.get_by_text("推荐方案")).to_be_visible()

    # Check Stats for "Actual Weekly Hours"
    # Course A: 2 credits, 32 hours (approx 2/week if 16 weeks, here 3 weeks -> ~10/week? mock data says 32 total)
    # Course B: 2 credits, 32 hours. Skippable.
    # Stats logic: actual = total - skippable.
    # Total hours: 64. Actual: 32.
    # Week span: 1-3. (3 weeks).
    # Actual Avg Weekly: 32 / 3 = 10.7

    stats_section = page.locator("#capture-area")
    expect(stats_section).to_contain_text("实际每周学时")

    # Check Green Cell
    # Course B is skippable. It is on Tue 9-10.
    # Tue is column index 3 (Node, Mon, Tue...).
    # Row 9-10.
    # Let's just look for the class `.cell-active.skippable`
    # Course B spans 2 periods, so we expect at least 1 visible, or strict mode fails if multiple.
    skippable_cell = page.locator(".cell-active.skippable").first
    expect(skippable_cell).to_be_visible()
    expect(skippable_cell).to_contain_text("Course B")

    # Screenshot
    page.screenshot(path="verification/spa_verified.png")

with sync_playwright() as playwright:
    run(playwright)
