from backend.solver import ScheduleSolver
from backend.ranker import ScheduleRanker

def test_logic():
    print("[*] Testing Logic...")

    # Dummy Course Data
    # Format: {'name': str, 'schedule_bitmaps': [0, ...]}

    # Course A: Mon 1-2 (Bit 0, 1)
    # Course B: Mon 1-2 (Conflict with A)
    # Course C: Mon 3-4 (No conflict with A)

    # Week 1 mask
    mask_a = (1 << 0) | (1 << 1)
    mask_b = (1 << 0) | (1 << 1)
    mask_c = (1 << 2) | (1 << 3)

    c_a = {'name': 'A', 'schedule_bitmaps': [0, mask_a, mask_a]}
    c_b = {'name': 'B', 'schedule_bitmaps': [0, mask_b, mask_b]}
    c_c = {'name': 'C', 'schedule_bitmaps': [0, mask_c, mask_c]}

    groups = [
        {
            'id': 1,
            'candidates': [c_a, c_b],
            'selected_indices': [0, 1]
        },
        {
            'id': 2,
            'candidates': [c_c, c_b], # c_b here creates conflict if chosen
            'selected_indices': [0, 1]
        }
    ]

    # 1. Conflict Check (Definite)
    # Group 1 has A, B. Group 2 has C, B.
    # A vs C: OK. A vs B: Fail. B vs C: OK. B vs B: Fail.
    # Not ALL combinations fail (A+C works). So no definite group conflict.
    conflicts = ScheduleSolver.check_conflicts(groups)
    assert len(conflicts) == 0, f"Unexpected conflicts: {conflicts}"
    print("    [+] Conflict Check 1 OK (No definite conflict)")

    # Force definite conflict
    # Group 3: Mon 1-2 only. Group 4: Mon 1-2 only.
    g3 = {'id': 3, 'candidates': [c_a], 'selected_indices': [0]}
    g4 = {'id': 4, 'candidates': [c_b], 'selected_indices': [0]}
    conflicts_2 = ScheduleSolver.check_conflicts([g3, g4])
    assert len(conflicts_2) == 1, "Should detect definite conflict"
    print("    [+] Conflict Check 2 OK (Definite conflict detected)")

    # 2. Generate Schedules (from orig groups)
    # Possible: A+C, A+B(X), B+C, B+B(X) -> Valid: A+C, B+C.
    schedules = ScheduleSolver.generate_schedules(groups)
    assert len(schedules) == 2, f"Expected 2 schedules, got {len(schedules)}"
    names = ["+".join([c['name'] for c in s]) for s in schedules]
    assert "A+C" in names and "B+C" in names
    print("    [+] Generation OK")

    # 3. Ranking
    # A+C (Mon 1-4). B+C (Mon 1-4).
    # Add preference: Avoid Early (1-2).
    # Both have early classes. Score should be low.
    ranker = ScheduleRanker()
    prefs = {'avoid_early_morning': True}
    score = ranker.score_schedule(schedules[0], prefs)
    assert score < 100, "Should be penalized for early morning"
    print(f"    [+] Ranking OK (Score: {score})")

if __name__ == "__main__":
    test_logic()
