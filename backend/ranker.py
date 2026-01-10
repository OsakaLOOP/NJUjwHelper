import math

class ScheduleRanker:
    @staticmethod
    def evaluate_schedule(schedule, preferences):
        """
        Evaluates a schedule based on preferences and returns score + breakdown.
        """
        base_score = 100.0
        details = {}
        total_penalty = 0.0
        total_bonus = 0.0

        # Merge bitmaps
        full_bitmap = [0] * 30 # Assume max weeks 25
        for course in schedule:
            cb = course.get('schedule_bitmaps', [])
            for w in range(len(cb)):
                if w < len(full_bitmap):
                    val = cb[w]
                    if isinstance(val, str):
                        try:
                            val = int(val)
                        except:
                            val = 0
                    full_bitmap[w] |= val

        # 1. Avoid Early Morning
        if preferences.get('avoid_early_morning'):
            penalty = 0
            for w in range(1, 26):
                mask = full_bitmap[w]
                if mask == 0: continue
                early_mask = 0
                for d in range(7):
                    early_mask |= (1 << (d * 13 + 0))
                    early_mask |= (1 << (d * 13 + 1))

                if (mask & early_mask):
                    penalty += 1

            p_val = penalty * 2
            total_penalty += p_val
            details['早八回避'] = -p_val

        # 2. Avoid Weekend
        if preferences.get('avoid_weekend'):
            penalty = 0
            weekend_mask = 0
            for node in range(13):
                weekend_mask |= (1 << (5 * 13 + node))
                weekend_mask |= (1 << (6 * 13 + node))

            for w in range(1, 26):
                if (full_bitmap[w] & weekend_mask):
                    penalty += 1

            p_val = penalty * 2.0
            total_penalty += p_val
            details['周末回避'] = -p_val

        # 3. Compactness
        if preferences.get('compactness') in ['high', 'low']:
            total_gaps = 0
            for w in range(1, 26):
                mask = full_bitmap[w]
                if mask == 0: continue
                for d in range(5): # Mon-Fri
                    day_bits = (mask >> (d * 13)) & 0x1FFF
                    if day_bits == 0: continue

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
                p_val = total_gaps * 0.2
                total_penalty += p_val
                details['课程紧凑'] = -p_val
            else:
                b_val = total_gaps * 0.2
                total_bonus += b_val
                details['课程分散'] = +b_val

        # 4. Max Daily Load
        limit = preferences.get('max_daily_load')
        if limit and limit > 0:
            overload = 0
            for w in range(1, 26):
                mask = full_bitmap[w]
                if mask == 0: continue
                for d in range(7):
                    day_bits = (mask >> (d * 13)) & 0x1FFF
                    count = bin(day_bits).count('1')
                    if count > limit:
                        overload += (count - limit)
            p_val = overload * 5.0
            total_penalty += p_val
            details['每日负载'] = -p_val

        # 5. Day Max Limit
        if preferences.get('day_max_limit_enabled'):
            limit = preferences.get('day_max_limit_value', 4)
            target_days = preferences.get('day_max_limit_days', [])
            if len(target_days) < 7:
                target_days = target_days + [False] * (7 - len(target_days))

            penalty = 0
            for w in range(1, 26):
                mask = full_bitmap[w]
                if mask == 0: continue
                for d in range(7):
                    if not target_days[d]: continue
                    day_bits = (mask >> (d * 13)) & 0x1FFF
                    count = bin(day_bits).count('1')
                    if count > limit:
                        diff = count - limit
                        penalty += diff * 50.0

            p_val = penalty
            total_penalty += p_val
            details['特定日限制'] = -p_val

        final_score = base_score + total_bonus - total_penalty
        return {
            'score': final_score,
            'details': details
        }

    @staticmethod
    def score_schedule(schedule, preferences):
        result = ScheduleRanker.evaluate_schedule(schedule, preferences)
        return result['score']
