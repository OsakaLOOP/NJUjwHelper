import itertools

class ScheduleSolver:
    @staticmethod
    def check_conflicts(groups):
        """
        Checks for definite conflicts between groups.
        A "definite conflict" between Group A and Group B exists if
        EVERY active candidate in Group A conflicts with EVERY active candidate in Group B.

        Returns: List of tuples (group_index_1, group_index_2) representing conflicting pairs.
        """
        conflicts = []
        n = len(groups)

        for i in range(n):
            for j in range(i + 1, n):
                group_a = groups[i]
                group_b = groups[j]

                # Get active candidates
                cands_a = [c for idx, c in enumerate(group_a['candidates']) if idx in group_a['selected_indices']]
                cands_b = [c for idx, c in enumerate(group_b['candidates']) if idx in group_b['selected_indices']]

                if not cands_a or not cands_b:
                    continue # Empty group cannot conflict

                all_conflict = True
                for ca in cands_a:
                    for cb in cands_b:
                        if not ScheduleSolver.courses_conflict(ca, cb):
                            all_conflict = False
                            break
                    if not all_conflict:
                        break

                if all_conflict:
                    conflicts.append((i, j))

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
    def generate_schedules(groups, max_results=1000):
        """
        Generates valid schedules by picking one active candidate from each group.
        Returns a list of schedules (each schedule is a list of courses).
        """
        # Prepare list of lists of candidates
        candidate_lists = []
        for g in groups:
            active = [c for idx, c in enumerate(g['candidates']) if idx in g['selected_indices']]
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
