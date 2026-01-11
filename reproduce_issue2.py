
import re

WEEKDAY_MAP = {"一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "日": 6, "天": 6}

class ScheduleBitmapper:
    REGEX_PATTERN = re.compile(r"周([一二三四五六日])\s*(\d+)-(\d+)节\s*([0-9,-]+)周")

    @staticmethod
    def parse_week_ranges(week_str):
        weeks = set()
        parts = week_str.split(',')
        for part in parts:
            if '-' in part:
                try:
                    s, e = map(int, part.split('-'))
                    weeks.update(range(s, e + 1))
                except: pass
            else:
                try:
                    weeks.add(int(part))
                except: pass
        return sorted(list(weeks))

    @staticmethod
    def generate_bitmap(location_text, max_weeks=25):
        semester_schedule = [0] * (max_weeks + 1)
        sessions = []

        if not location_text:
            return [str(x) for x in semester_schedule], sessions

        segments = re.split(r'[,;]', location_text)

        for seg in segments:
            print(f"Processing segment: '{seg}'")
            matches = list(ScheduleBitmapper.REGEX_PATTERN.finditer(seg))
            if not matches:
                print("  No matches found!")
                continue

            print(f"  Found {len(matches)} matches.")

            location_part = seg
            for m in matches:
                location_part = location_part.replace(m.group(0), "")
            location_part = location_part.replace("(单)", "").replace("(双)", "").strip()

            for match in matches:
                day_char, start_node, end_node, week_range_str = match.groups()
                print(f"  Match: Day={day_char}, Start={start_node}, End={end_node}, Weeks={week_range_str}")

                day_idx = WEEKDAY_MAP.get(day_char, 0)
                s_node = int(start_node)
                e_node = int(end_node)
                active_weeks = ScheduleBitmapper.parse_week_ranges(week_range_str)

                print(f"  Active Weeks: {active_weeks}")

                # ... (rest of logic)

test_string = "周四 9-11节 3-16周 科技馆210、216、301、302、305、308、310、311、313/315/316/318"
print(f"Testing string: {test_string}")
ScheduleBitmapper.generate_bitmap(test_string)
