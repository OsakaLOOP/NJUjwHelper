import time
import random
from backend.solver import ScheduleSolver

def test_scalability():
    print("[*] Testing Scalability...")

    # 10 Groups, 5 Candidates each.
    # Total space: 5^10 = 9.7 million.
    # We want to confirm it doesn't hang.

    # Generate random candidates
    # To encourage pruning/conflicts, use a small week range or few slots.
    # E.g. All classes on Mon-Fri, 13 slots/day. 65 slots.
    # Each class takes 2 slots.

    random.seed(42) # Deterministic

    groups = []
    for g_id in range(10):
        cands = []
        for c_id in range(5):
            # Random slot
            day = random.randint(0, 4)
            slot = random.randint(0, 11) # Slots 0-11 (for size 2)

            # Bitmap
            bm = [0] * 30
            # Set bits for day/slot and day/slot+1
            mask = (1 << (day*13 + slot)) | (1 << (day*13 + slot + 1))
            bm[1] = mask # Week 1

            cands.append({
                'name': f'G{g_id}_C{c_id}',
                'schedule_bitmaps': bm,
                'selected': True
            })

        groups.append({
            'id': g_id,
            'candidates': cands
        })

    print(f"    [i] Generated 10 groups, 5 candidates each. (Space ~9.7M)")

    start_time = time.time()
    schedules, total = ScheduleSolver.generate_schedules(groups, max_results=20)
    end_time = time.time()

    duration = end_time - start_time
    print(f"    [+] Finished in {duration:.4f} seconds.")
    print(f"    [+] Found {total} valid schedules (Top {len(schedules)} returned).")

    # Assert it finished reasonably fast (e.g. < 20s)
    if duration > 20.0:
        print("    [-] Too slow!")
        exit(1)
    else:
        print("    [+] Scalability OK.")

if __name__ == "__main__":
    test_scalability()
