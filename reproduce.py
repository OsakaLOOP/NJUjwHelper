import json
import sys
import os

# Add project root to path
sys.path.append(os.getcwd())

from backend.solver import ScheduleSolver
from backend.ranker import ScheduleRanker

def test_duplication_repro():
    with open('saved_sessions/last_session.json', 'r', encoding='utf-8') as f:
        data = json.load(f)

    groups = data['groups']
    
    # Enable all candidates for testing (or stick to 'selected' ones if that's the logic)
    # The solver only looks at 'selected' candidates usually, or all if none selected?
    # backend/solver.py: active = [c for c in g['candidates'] if c.get('selected', False)]
    # In the json, some are selected, some are not.
    # Let's ensure we respect the 'selected' flag as the solver does.
    
    print(f"Loaded {len(groups)} groups.")
    
    # Run solver
    schedules, total_count = ScheduleSolver.generate_schedules(groups, max_results=10)
    print(f"Generated {len(schedules)} schedules (Total found: {total_count}).")

    if not schedules:
        print("No schedules found! Checking if candidates are selected...")
        for i, g in enumerate(groups):
            selected_count = len([c for c in g['candidates'] if c.get('selected')])
            print(f"Group {i} has {selected_count} selected candidates.")
        return

    # Check for duplicates in the first schedule
    first_sched = schedules[0]
    course_names = [c['name'] for c in first_sched]
    course_codes = [c.get('code') for c in first_sched]
    
    print("\nFirst Schedule Courses:")
    for name, code in zip(course_names, course_codes):
        print(f" - {name} ({code})")

    # specific check for Physics Lab
    lab_count = sum(1 for name in course_names if "大学物理实验" in name)
    if lab_count > 1:
        print(f"\nFAILURE: Found {lab_count} '大学物理实验' courses in one schedule.")
    else:
        print(f"\nSUCCESS: Found {lab_count} '大学物理实验' course.")

if __name__ == "__main__":
    test_duplication_repro()
