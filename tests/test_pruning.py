from backend.solver import ScheduleSolver
from backend.ranker import ScheduleRanker

def test_pruning_bug():
    print("[*] Testing Pruning Bug...")

    # Scenario:
    # Preference: avoid_early_morning (Penalty), compactness='low' (Bonus).

    # Group 1:
    #   C1: Mon 5 (Slot 4). Score 100.
    #   C2: Tue 1 (Slot 0). Early Penalty (-2). Partial Score 98.

    # Group 2:
    #   C3: Mon 6 (Slot 5).
    #       With C1: Same day, adjacent. Gap 0. Bonus 0. Total 100.
    #       With C2: Different days. Gap 0. Total 98.

    #   C4: Tue 13 (Slot 12).
    #       With C1: Different days. Gap 0. Total 100.
    #       With C2: Same day. Gap 1 to 12. 11 slots. Bonus 2.2.
    #                Total = 100 - 2 + 2.2 = 100.2. (WINNER).

    # Execution Order (assuming C1 before C2, C3 before C4):
    # 1. Backtrack(G1) -> Pick C1. Partial 100.
    # 2. Backtrack(G2) -> Pick C3. [C1, C3]. Score 100.
    #    Heap = [100].
    # 3. Backtrack(G2) -> Pick C4. [C1, C4]. Score 100.
    #    Heap unchanged (max_results=1, new score not > top).
    # 4. Backtrack(G1) -> Pick C2. Partial Score 98.
    # 5. Pruning Check: 98 < Heap[0] (100).
    #    PRUNED!
    # 6. [C2, C4] (Score 100.2) is never found.

    # Bitmaps
    def make_cand(name, day_idx, slot_idx):
        # day_idx: 0=Mon, 1=Tue...
        # bit = day*13 + slot
        bit = day_idx * 13 + slot_idx
        mask = (1 << bit)
        bm = [0] * 30
        bm[1] = mask
        return {'name': name, 'schedule_bitmaps': bm, 'selected': True}

    c1 = make_cand('C1', 0, 4) # Mon 5
    c2 = make_cand('C2', 1, 0) # Tue 1 (Early)
    c3 = make_cand('C3', 0, 5) # Mon 6
    c4 = make_cand('C4', 1, 12) # Tue 13

    g1 = {'id': 1, 'candidates': [c1, c2]}
    g2 = {'id': 2, 'candidates': [c3, c4]}

    prefs = {'avoid_early_morning': True, 'compactness': 'low'}

    schedules, total = ScheduleSolver.generate_schedules([g1, g2], max_results=1, preferences=prefs)

    print(f"DEBUG: Found {len(schedules)} schedules.")
    if len(schedules) > 0:
        best = schedules[0]
        names = sorted([c['name'] for c in best])
        score = ScheduleRanker.score_schedule(best, prefs)
        print(f"DEBUG: Best Schedule: {names}, Score: {score}")

        # Check if C2+C4 is the result
        if 'C2' in names and 'C4' in names:
            print("    [+] Success! Found optimal schedule with Bonus.")
        else:
            print("    [-] Failure! Pruned optimal schedule (Found sub-optimal).")
            # We exit with success here if we WANT to demonstrate failure?
            # No, test should fail if bug exists.
            exit(1)
    else:
        print("    [-] No schedules found.")
        exit(1)

if __name__ == "__main__":
    test_pruning_bug()
