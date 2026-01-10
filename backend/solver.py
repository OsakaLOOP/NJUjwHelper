import heapq
import itertools
from .ranker import ScheduleRanker

class ScheduleSolver:
    @staticmethod
    def check_conflicts(groups):
        """
        Checks for definite conflicts between groups.
        A "definite conflict" between Group A and Group B exists if
        EVERY active candidate in Group A conflicts with EVERY active candidate in Group B.

        Returns: List of tuples (group_index_1, group_index_2, reason) representing conflicting pairs.
        """
        conflicts = []
        n = len(groups)

        for i in range(n):
            for j in range(i + 1, n):
                group_a = groups[i]
                group_b = groups[j]

                # Get active candidates
                cands_a = [c for c in group_a['candidates'] if c.get('selected', False)]
                cands_b = [c for c in group_b['candidates'] if c.get('selected', False)]

                if not cands_a or not cands_b:
                    continue # Empty group cannot conflict

                all_conflict = True
                first_reason = None

                for ca in cands_a:
                    pair_conflict = False
                    for cb in cands_b:
                        is_conf, details = ScheduleSolver.courses_conflict_with_details(ca, cb)
                        if is_conf:
                            pair_conflict = True
                            if not first_reason:
                                first_reason = details
                        else:
                            pair_conflict = False
                            break

                    if not pair_conflict:
                        all_conflict = False
                        break

                if all_conflict:
                    conflicts.append((i, j, first_reason or "Unknown"))

        return conflicts

    @staticmethod
    def courses_conflict(course_a, course_b):
        """
        Checks if two courses conflict in time.
        Uses bitwise AND on schedule bitmaps.
        """
        bmp_a = course_a.get('schedule_bitmaps', [])
        bmp_b = course_b.get('schedule_bitmaps', [])

        length = min(len(bmp_a), len(bmp_b))

        for w in range(1, length):
            if (bmp_a[w] & bmp_b[w]) != 0:
                return True
        return False

    @staticmethod
    def courses_conflict_with_details(course_a, course_b):
        """
        Checks if two courses conflict and returns details.
        Returns: (bool, str_reason)
        """
        bmp_a = course_a.get('schedule_bitmaps', [])
        bmp_b = course_b.get('schedule_bitmaps', [])
        length = min(len(bmp_a), len(bmp_b))

        for w in range(1, length):
            overlap = bmp_a[w] & bmp_b[w]
            if overlap != 0:
                # Decode bits to find Day and Node
                # Bit pos: Day(0-6)*13 + Node(0-12)
                for bit in range(91): # 7*13=91
                    if (overlap >> bit) & 1:
                        day = (bit // 13) + 1
                        node = (bit % 13) + 1
                        return True, f"Week {w} Day {day} Node {node}"
        return False, ""

    @staticmethod
    def generate_schedules(groups, max_results=20, preferences=None):
        """
        Generates valid schedules using DFS with Pruning and Meta-Candidate Clustering.
        Returns a list of top scoring schedules (each schedule is a list of courses).
        """
        if preferences is None:
            preferences = {}

        # 0. Preprocess: Merge Groups with Identical Name (First candidate's name)
        # This handles cases where user accidentally has 2 groups for "Phys Lab".
        merged_groups_map = {} # Key: Course Name -> Group Data

        for g in groups:
            candidates = g.get('candidates', [])
            if not candidates:
                continue

            # Use the first candidate's name as the Group Identifier
            # (Assuming all candidates in a group belong to the same 'Course Name' broadly)
            course_name = candidates[0].get('name')
            if not course_name:
                 # Fallback if name missing, just use ID or keep separate
                 course_name = f"__ID_{g.get('id')}__"

            if course_name not in merged_groups_map:
                # Initialize with this group structure
                # Deep copy candidates to avoid mutating original
                merged_groups_map[course_name] = {
                    'id': g.get('id'),
                    'candidates': [c for c in candidates if c.get('selected', False)] # Only active
                }
            else:
                # Merge candidates
                existing = merged_groups_map[course_name]
                new_active = [c for c in candidates if c.get('selected', False)]
                # Avoid duplicates in candidate list?
                # Candidates are dicts.
                # Let's just append for now, Meta-Candidate step will cluster by time anyway.
                existing['candidates'].extend(new_active)

        # Convert back to list
        processed_groups = list(merged_groups_map.values())

        # 1. Preprocess: Filter active and Cluster by Bitmap (Meta-Candidates)
        meta_groups = []
        for g in processed_groups:
            active = g['candidates']
            if not active:
                # If a group has NO active candidates after merge, it's a dead end.
                # "I need one choice per group". If 0 choices, invalid.
                return []

            # Cluster by unique bitmap content
            clusters = {}
            for c in active:
                bm_tuple = tuple(c.get('schedule_bitmaps', []))
                if bm_tuple not in clusters:
                    clusters[bm_tuple] = []
                clusters[bm_tuple].append(c)

            # Create Meta-Candidates
            meta_candidates = []
            for bm_tuple, c_list in clusters.items():
                rep = c_list[0]
                meta_candidates.append({
                    'representative': rep,
                    'bitmaps': bm_tuple, # Tuple of ints
                    'alternatives': c_list,
                })

            # Optimization: Sort meta-candidates by "density" (fewest bits set)
            # to succeed easier? Or heuristic from Ranker?
            # Let's sort by: (Number of conflicts with EMPTY schedule) -> just density.
            # Less dense courses are easier to fit.
            meta_candidates.sort(key=lambda m: sum(bin(x).count('1') for x in m['bitmaps']))

            meta_groups.append(meta_candidates)

        # 2. DFS Initialization
        top_n_heap = [] # Min-Heap of (score, unique_id, schedule)

        # Use a list for bitmap to allow mutation
        current_bitmap = [0] * 30

        counter = itertools.count()

        # Pre-calculate group order?
        # Heuristic: Process groups with FEWEST options first (Fail Fast).
        # MRV (Minimum Remaining Values).
        # meta_groups is a list of lists.
        # Let's preserve index to map back? No, result order doesn't matter for correctness,
        # but for consistent display maybe?
        # We just need to return a list of courses. Order in list doesn't matter.
        # So we can reorder groups.

        # Wrap meta_groups with index so we can debug if needed, or just sort.
        # sort by len(candidates)
        # meta_groups.sort(key=len) -> This makes `backtrack` simpler.
        meta_groups.sort(key=len)

        def backtrack(group_idx, current_schedule_meta):
            if group_idx == len(meta_groups):
                # Found a valid schedule
                final_schedule = [m['representative'] for m in current_schedule_meta]
                score = ScheduleRanker.score_schedule(final_schedule, preferences)

                entry = (score, next(counter), final_schedule)
                if len(top_n_heap) < max_results:
                    heapq.heappush(top_n_heap, entry)
                else:
                    if score > top_n_heap[0][0]:
                        heapq.heapreplace(top_n_heap, entry)
                return

            # Pruning
            if len(top_n_heap) == max_results:
                partial_sched = [m['representative'] for m in current_schedule_meta]
                partial_score = ScheduleRanker.score_schedule(partial_sched, preferences)
                # Upper bound check (assuming score decreases with penalties)
                # If partial score is already too low, we can't recover.
                if partial_score < top_n_heap[0][0]:
                    return

            candidates = meta_groups[group_idx]

            for meta in candidates:
                meta_bmp = meta['bitmaps']

                # Check Conflict
                is_valid = True
                limit = min(len(meta_bmp), len(current_bitmap))
                for w in range(1, limit):
                    if (meta_bmp[w] & current_bitmap[w]) != 0:
                        is_valid = False
                        break

                if not is_valid:
                    continue

                # Apply
                for w in range(1, limit):
                    current_bitmap[w] |= meta_bmp[w]

                current_schedule_meta.append(meta)

                backtrack(group_idx + 1, current_schedule_meta)

                # Undo
                current_schedule_meta.pop()
                for w in range(1, limit):
                    current_bitmap[w] ^= meta_bmp[w]

        backtrack(0, [])

        sorted_results = sorted(top_n_heap, key=lambda x: x[0], reverse=True)
        return [item[2] for item in sorted_results]

    @staticmethod
    def is_valid_combination(courses):
        for i in range(len(courses)):
            for j in range(i + 1, len(courses)):
                if ScheduleSolver.courses_conflict(courses[i], courses[j]):
                    return False
        return True
