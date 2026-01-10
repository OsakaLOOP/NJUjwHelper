import math

class ScheduleRanker:
    @staticmethod
    def score_schedule(schedule, preferences):
        """
        Scores a schedule based on preferences.
        Lower score is better? Or Higher? Let's say Higher is better.

        Preferences:
        - avoid_early_morning (bool): 1-2节
        - avoid_weekend (bool): Sat/Sun
        - compactness (str): "high" (bunch together), "low" (spread out), "none"
        - max_daily_load (int): Penalty if > X
        """
        score = 100.0

        # Merge bitmaps
        full_bitmap = [0] * 30 # Assume max weeks 25
        for course in schedule:
            cb = course.get('schedule_bitmaps', [])
            for w in range(len(cb)):
                if w < len(full_bitmap):
                    full_bitmap[w] |= cb[w]

        # 1. Avoid Early Morning (Nodes 1-2 -> Bits 0-1, 13-14, etc.)
        if preferences.get('avoid_early_morning'):
            penalty = 0
            for w in range(1, 26): # Check typical weeks
                mask = full_bitmap[w]
                if mask == 0: continue
                # Early morning mask: Day 0..6, Nodes 0..1
                # Bit pos = day*13 + node
                early_mask = 0
                for d in range(7):
                    early_mask |= (1 << (d * 13 + 0))
                    early_mask |= (1 << (d * 13 + 1))

                if (mask & early_mask):
                    penalty += 1
            score -= penalty * 0.5 # Small penalty per occurrence

        # 2. Avoid Weekend (Days 5, 6)
        if preferences.get('avoid_weekend'):
            penalty = 0
            weekend_mask = 0
            # Day 5 (Sat), Day 6 (Sun). All 13 nodes.
            # Bits 65-77 (Sat), 78-90 (Sun) ... wait 5*13=65.
            for node in range(13):
                weekend_mask |= (1 << (5 * 13 + node))
                weekend_mask |= (1 << (6 * 13 + node))

            for w in range(1, 26):
                if (full_bitmap[w] & weekend_mask):
                    penalty += 1
            score -= penalty * 2.0 # Higher penalty for weekends

        # 3. Compactness (Variance of start times? Or density?)
        # Let's use daily variance.
        # Compact -> High density, few gaps.
        # Spread -> Evenly distributed.
        if preferences.get('compactness') in ['high', 'low']:
            # Calculate gaps
            total_gaps = 0
            for w in range(1, 26):
                mask = full_bitmap[w]
                if mask == 0: continue
                for d in range(5): # Mon-Fri
                    day_bits = (mask >> (d * 13)) & 0x1FFF
                    if day_bits == 0: continue

                    # Convert to string binary to find 101 patterns (gap)
                    bin_str = bin(day_bits)[2:].zfill(13) # LSB is 1st class?
                    # Actually LSB is node 0 (1st class). `bin` output is MSB left.
                    # Let's just iterate
                    has_started = False
                    gap_count = 0
                    current_gap = 0

                    for i in range(13):
                        is_set = (day_bits >> i) & 1
                        if is_set:
                            if has_started and current_gap > 0:
                                gap_count += current_gap
                            has_started = True
                            current_gap = 0
                        elif has_started:
                            current_gap += 1

                    total_gaps += gap_count

            if preferences['compactness'] == 'high':
                score -= total_gaps * 0.5 # Penalty for gaps
            else:
                score += total_gaps * 0.5 # Bonus for gaps (spread)

        # 4. Max Daily Load
        limit = preferences.get('max_daily_load')
        if limit and limit > 0:
            overload = 0
            for w in range(1, 26):
                mask = full_bitmap[w]
                if mask == 0: continue
                for d in range(7):
                    day_bits = (mask >> (d * 13)) & 0x1FFF
                    # Count set bits
                    count = bin(day_bits).count('1')
                    if count > limit:
                        overload += (count - limit)
            score -= overload * 5.0 # Heavy penalty

        # 5. Day Max Limit (Specific Days)
        if preferences.get('day_max_limit_enabled'):
            limit = preferences.get('day_max_limit_value', 4)
            target_days = preferences.get('day_max_limit_days', []) # List of bools, idx 0=Mon

            penalty = 0
            # Ensure target_days has 7 elements
            if len(target_days) < 7:
                target_days = target_days + [False] * (7 - len(target_days))

            for w in range(1, 26):
                mask = full_bitmap[w]
                if mask == 0: continue

                for d in range(7):
                    # Check if this day is selected for limiting
                    if not target_days[d]:
                        continue

                    day_bits = (mask >> (d * 13)) & 0x1FFF
                    count = bin(day_bits).count('1')

                    if count > limit:
                        # Penalty calculation
                        # If limit is 0 (day off), any class is bad.
                        diff = count - limit
                        penalty += diff * 50.0 # Very heavy penalty

            score -= penalty

        return score
