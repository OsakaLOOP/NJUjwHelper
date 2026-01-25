from backend.solver import ScheduleSolver
from backend.ranker import ScheduleRanker

def test_logic():
    print("[*] Testing Logic...")

    # Dummy Course Data
    # Format: {'name': str, 'schedule_bitmaps': [0, ...]}
    # Added 'selected': True to match solver expectation

    # Course A: Mon 1-2 (Bit 0, 1)
    # Course B: Mon 1-2 (Conflict with A)
    # Course C: Mon 3-4 (No conflict with A)

    # Week 1 mask
    mask_a = (1 << 0) | (1 << 1)
    mask_b = (1 << 0) | (1 << 1)
    mask_c = (1 << 2) | (1 << 3)

    c_a = {'name': 'A', 'schedule_bitmaps': [0, mask_a, mask_a], 'selected': True}
    c_b = {'name': 'B', 'schedule_bitmaps': [0, mask_b, mask_b], 'selected': True}
    c_c = {'name': 'C', 'schedule_bitmaps': [0, mask_c, mask_c], 'selected': True}

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
    schedules, total = ScheduleSolver.generate_schedules(groups)
    # Note: generate_schedules returns (schedules, count)

    # Due to Meta-Candidate optimization, A and B (identical time) are clustered.
    # So we get 1 schedule: [A (alts A,B), C].
    # This represents both A+C and B+C.
    assert len(schedules) == 1, f"Expected 1 meta-schedule, got {len(schedules)}"

    sched = schedules[0]
    # Find the course from Group 1 (A or B)
    # Check if it has 2 alternatives

    # Identify by name
    names = [c['name'] for c in sched]
    assert 'C' in names

    # The other one is A (rep) or B (rep)
    other = [c for c in sched if c['name'] != 'C'][0]
    # Check alternatives
    alts = other.get('alternatives', [])
    alt_names = [a['name'] for a in alts]
    assert 'A' in alt_names and 'B' in alt_names, f"Expected alternatives A and B, got {alt_names}"

    print("    [+] Generation OK (Meta-Candidates verified)")

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
