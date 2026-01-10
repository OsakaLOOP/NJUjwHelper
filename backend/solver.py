import itertools

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
        # Bitmaps are lists of ints, index 1-25 (usually).
        # We check overlapping weeks.

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
    def generate_schedules(groups, max_results=1000):
        """
        Generates valid schedules by picking one active candidate from each group.
        Returns a list of schedules (each schedule is a list of courses).
        """
        # Prepare list of lists of candidates
        candidate_lists = []
        for g in groups:
            active = [c for c in g['candidates'] if c.get('selected', False)]
            if not active:
                return [] # If any group has no active candidates, no solution possible
            candidate_lists.append(active)

        # Cartesian product
        # NOTE: With many groups/candidates, this can explode.
        # But for course scheduling usually it's manageable (e.g. 5-10 groups, 2-5 options each).
        # We iterate and filter.

        valid_schedules = []

        for combination in itertools.product(*candidate_lists):
            if ScheduleSolver.is_valid_combination(combination):
                valid_schedules.append(combination)
                if len(valid_schedules) >= max_results:
                    break

        return valid_schedules

    @staticmethod
    def is_valid_combination(courses):
        """Checks if a set of courses has any internal conflict."""
        for i in range(len(courses)):
            for j in range(i + 1, len(courses)):
                if ScheduleSolver.courses_conflict(courses[i], courses[j]):
                    return False
        return True
