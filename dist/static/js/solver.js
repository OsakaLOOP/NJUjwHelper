class ScheduleRanker {
    static evaluateSchedule(schedule, preferences) {
        let baseScore = 100.0;
        const details = {};
        let totalPenalty = 0.0;
        let totalBonus = 0.0;

        // 0. Bitmaps
        // fullBitmap: All courses (for debugging/future use)
        // scoringBitmap: Non-skippable courses (Main Penalty, Weight 1.0)
        // skippableBitmap: Skippable courses (Shadow Penalty, Weight 0.01)
        const fullBitmap = Array(30).fill(0n);
        const scoringBitmap = Array(30).fill(0n);
        const skippableBitmap = Array(30).fill(0n);

        for (const course of schedule) {
            const cb = course.schedule_bitmaps || [];
            const isSkippable = !!course.is_skippable;

            for (let w = 0; w < cb.length; w++) {
                if (w < fullBitmap.length) {
                    let val = 0n;
                    try {
                        val = BigInt(cb[w]);
                    } catch (e) {
                        val = 0n;
                    }
                    fullBitmap[w] |= val;
                    if (!isSkippable) {
                        scoringBitmap[w] |= val;
                    } else {
                        skippableBitmap[w] |= val;
                    }
                }
            }
        }

        // Helper to calculate penalty for a given bitmap and weight
        const calcPenalty = (bitmap, weight, isShadow = false) => {
            let p = 0.0;

            // 1. Avoid Early Morning
            if (preferences.avoid_early_morning) {
                let count = 0;
                for (let w = 1; w <= 25; w++) {
                    const mask = bitmap[w];
                    if (mask === 0n) continue;
                    let earlyMask = 0n;
                    for (let d = 0; d < 7; d++) {
                        earlyMask |= (1n << BigInt(d * 13 + 0)); // Node 1
                        earlyMask |= (1n << BigInt(d * 13 + 1)); // Node 2
                    }
                    if ((mask & earlyMask) !== 0n) count++;
                }
                const val = count * 2.0 * weight;
                p += val;
                if (!isShadow) details['早八回避'] = -val;
            }

            // 2. Avoid Weekend
            if (preferences.avoid_weekend) {
                let count = 0;
                let weekendMask = 0n;
                for (let node = 0; node < 13; node++) {
                    weekendMask |= (1n << BigInt(5 * 13 + node)); // Sat
                    weekendMask |= (1n << BigInt(6 * 13 + node)); // Sun
                }
                for (let w = 1; w <= 25; w++) {
                    if ((bitmap[w] & weekendMask) !== 0n) count++;
                }
                const val = count * 2.0 * weight;
                p += val;
                if (!isShadow) details['周末回避'] = -val;
            }

            // 3. Compactness
            if (preferences.compactness === 'high' || preferences.compactness === 'low') {
                let totalGaps = 0;
                for (let w = 1; w <= 25; w++) {
                    const mask = bitmap[w];
                    if (mask === 0n) continue;
                    for (let d = 0; d < 5; d++) { // Mon-Fri
                        const dayBits = (mask >> BigInt(d * 13)) & 0x1FFFn;
                        if (dayBits === 0n) continue;

                        let hasStarted = false;
                        let gapCount = 0;
                        let currentGap = 0;

                        for (let i = 0; i < 13; i++) {
                            const isSet = (dayBits >> BigInt(i)) & 1n;
                            if (isSet) {
                                if (hasStarted && currentGap > 0) {
                                    gapCount += currentGap;
                                }
                                hasStarted = true;
                                currentGap = 0;
                            } else if (hasStarted) {
                                currentGap += 1;
                            }
                        }
                        totalGaps += gapCount;
                    }
                }

                if (preferences.compactness === 'high') {
                    const val = totalGaps * 0.2 * weight;
                    p += val;
                    if (!isShadow) details['课程紧凑'] = -val;
                } else {
                    // For shadow penalty, we treat 'low' compactness bonus as negative penalty?
                    // Or just ignore bonus for shadow to keep it simple?
                    // Let's implement bonus as negative penalty.
                    const val = totalGaps * 0.2 * weight;
                    // Bonus means score increases. Penalty means score decreases.
                    // If compact=low, we want MORE gaps.
                    // So totalGaps contributes to BONUS.
                    // Score = Base + Bonus - Penalty.
                    // Here p is Penalty accumulator.
                    // So we should SUBTRACT from p?
                    // Wait, existing logic: totalBonus += val.
                    // So return { penalty, bonus }.
                    // Let's keep it simple: Shadow penalty only considers NEGATIVE traits (Penalties).
                    // We ignore Compactness Bonus for shadow to avoid complexity.
                    if (!isShadow) {
                        // Handled outside or allow this function to return object?
                        // Let's just handle non-shadow compactness separately if needed.
                        // But for simplicity, let's just do the penalty part here.
                        // If compact=low (Bonus), we skip adding to 'p'.
                    }
                }
            }

            // 4. Day Max Limit
            if (preferences.day_max_limit_enabled) {
                const limitVal = preferences.day_max_limit_value ?? 4;
                let targetDays = preferences.day_max_limit_days || [];
                if (targetDays.length < 7) {
                    targetDays = targetDays.concat(Array(7 - targetDays.length).fill(false));
                }

                let penalty = 0;
                for (let w = 1; w <= 25; w++) {
                    const mask = bitmap[w];
                    if (mask === 0n) continue;
                    for (let d = 0; d < 7; d++) {
                        if (!targetDays[d]) continue;
                        const dayBits = (mask >> BigInt(d * 13)) & 0x1FFFn;
                        const count = ScheduleRanker.countSetBits(dayBits);
                        if (count > limitVal) {
                            const diff = count - limitVal;
                            penalty += diff * 2.0;
                        }
                    }
                }
                const val = penalty * weight;
                p += val;
                if (!isShadow) details['特定日限制'] = -val;
            }

            // 5. Quality Sleep (Avoid 8-13)
            // User Update: Should start from Node 9 (Index 8).
            // Nodes are 0-indexed (0-12) corresponding to 1-13.
            // Node 9 (1-based) is index 8.
            // Node 13 (1-based) is index 12.
            if (preferences.quality_sleep) {
                let count = 0;
                for (let w = 1; w <= 25; w++) {
                    const mask = bitmap[w];
                    if (mask === 0n) continue;

                    let sleepMask = 0n;
                    for (let d = 0; d < 7; d++) {
                         for (let n = 8; n <= 12; n++) { // Corrected range 9-13 (indices 8-12)
                             sleepMask |= (1n << BigInt(d * 13 + n));
                         }
                    }

                    if ((mask & sleepMask) !== 0n) {
                        count++;
                    }
                }
                const val = count * 2.0 * weight;
                p += val;
                if (!isShadow) details['优质睡眠'] = -val;
            }

            return p;
        };

        // Calculate Main Penalty (Weight 1.0)
        const mainPenalty = calcPenalty(scoringBitmap, 1.0, false);
        totalPenalty += mainPenalty;

        // Calculate Shadow Penalty (Weight 0.01)
        const shadowPenalty = calcPenalty(skippableBitmap, 0.01, true);
        totalPenalty += shadowPenalty;

        // Handle Compactness Bonus explicitly for Main (since helper ignored it or we need to be careful)
        // Re-implement Compactness Bonus for Main only to match exact logic of previous version
        if (preferences.compactness === 'low') {
            let totalGaps = 0;
            for (let w = 1; w <= 25; w++) {
                const mask = scoringBitmap[w];
                if (mask === 0n) continue;
                for (let d = 0; d < 5; d++) {
                    const dayBits = (mask >> BigInt(d * 13)) & 0x1FFFn;
                    if (dayBits === 0n) continue;
                    let hasStarted = false;
                    let currentGap = 0;
                    for (let i = 0; i < 13; i++) {
                        const isSet = (dayBits >> BigInt(i)) & 1n;
                        if (isSet) {
                            if (hasStarted && currentGap > 0) totalGaps += currentGap;
                            hasStarted = true;
                            currentGap = 0;
                        } else if (hasStarted) {
                            currentGap += 1;
                        }
                    }
                }
            }
            const bVal = totalGaps * 0.2;
            totalBonus += bVal;
            details['课程分散'] = +bVal;
        }

        return {
            score: baseScore + totalBonus - totalPenalty,
            details: details
        };
    }

    static countSetBits(n) {
        // n is BigInt
        let count = 0;
        while (n > 0n) {
            n &= (n - 1n);
            count++;
        }
        return count;
    }

    static scoreSchedule(schedule, preferences) {
        return ScheduleRanker.evaluateSchedule(schedule, preferences).score;
    }
}

class ScheduleSolver {
    static parseBitmap(bitmapList) {
        return (bitmapList || []).map(x => {
            try {
                return BigInt(x);
            } catch {
                return 0n;
            }
        });
    }

    static coursesConflictWithDetails(courseA, courseB) {
        const bmpA = ScheduleSolver.parseBitmap(courseA.schedule_bitmaps);
        const bmpB = ScheduleSolver.parseBitmap(courseB.schedule_bitmaps);
        const length = Math.min(bmpA.length, bmpB.length);

        for (let w = 1; w < length; w++) {
            const overlap = bmpA[w] & bmpB[w];
            if (overlap !== 0n) {
                for (let bit = 0; bit < 91; bit++) {
                    if ((overlap >> BigInt(bit)) & 1n) {
                        const day = Math.floor(bit / 13) + 1;
                        const node = (bit % 13) + 1;
                        return { conflict: true, reason: `Week ${w} Day ${day} Node ${node}` };
                    }
                }
            }
        }
        return { conflict: false, reason: "" };
    }

    static checkConflicts(groups) {
        const conflicts = [];
        const n = groups.length;

        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                const activeA = groups[i].candidates.filter(c => c.selected);
                const activeB = groups[j].candidates.filter(c => c.selected);

                if (activeA.length === 0 || activeB.length === 0) continue;

                // If either group is skippable, they do not cause hard conflicts.
                // We treat them as ghosts that can overlap anything.
                if (groups[i].is_skippable || groups[j].is_skippable) continue;

                let allConflict = true;
                let firstReason = null;

                for (const ca of activeA) {
                    let pairConflict = false;
                    for (const cb of activeB) {
                        const { conflict, reason } = ScheduleSolver.coursesConflictWithDetails(ca, cb);
                        if (conflict) {
                            pairConflict = true;
                            if (!firstReason) firstReason = reason;
                        } else {
                            pairConflict = false;
                            break;
                        }
                    }
                    if (!pairConflict) {
                        allConflict = false;
                        break;
                    }
                }

                if (allConflict) {
                    const nameA = activeA[0].name || `Group ${i}`;
                    const nameB = activeB[0].name || `Group ${j}`;
                    return { error: `检测到绝对冲突: [${nameA}] 与 [${nameB}] 无法同时选择 (冲突原因: ${firstReason})` };
                }
            }
        }
        return null;
    }

    static generateSchedules(groups, preferences) {
        const maxResults = 20;
        preferences = preferences || {};

        // 0. Preprocess: Filter Empty Groups & Merge
        const mergedGroupsMap = new Map();

        // Use filtered groups for logic
        const nonEmptyGroups = groups.filter(g => g.candidates && g.candidates.some(c => c.selected));

        if (nonEmptyGroups.length === 0) {
            return { schedules: [], total_found: 0 };
        }

        // 1. Check for Absolute Conflicts First
        const conflictErr = ScheduleSolver.checkConflicts(nonEmptyGroups);
        if (conflictErr) {
            return { schedules: [], total_found: 0, error: conflictErr.error };
        }

        // 2. Prepare Meta-Groups
        for (const g of nonEmptyGroups) {
            const active = g.candidates.filter(c => c.selected);
            let courseName = active[0].name;
            if (!courseName) courseName = `__ID_${g.id}__`;

            if (!mergedGroupsMap.has(courseName)) {
                mergedGroupsMap.set(courseName, {
                    id: g.id,
                    name: courseName,
                    candidates: active,
                    is_skippable: !!g.is_skippable
                });
            } else {
                const existing = mergedGroupsMap.get(courseName);
                existing.candidates = existing.candidates.concat(active);
                if (g.is_skippable) existing.is_skippable = true;
            }
        }

        const metaGroups = [];
        for (const g of mergedGroupsMap.values()) {
            const active = g.candidates;

            // Cluster by time slots (bitmaps)
            const clusters = new Map();
            for (const c of active) {
                const rawBm = c.schedule_bitmaps || [];
                const intBm = ScheduleSolver.parseBitmap(rawBm);
                const key = intBm.join(',');

                if (!clusters.has(key)) {
                    clusters.set(key, { bitmaps: intBm, list: [] });
                }
                clusters.get(key).list.push(c);
            }

            const metaCandidates = [];
            for (const val of clusters.values()) {
                metaCandidates.push({
                    representative: val.list[0],
                    bitmaps: val.bitmaps,
                    alternatives: val.list,
                    is_skippable: g.is_skippable // Propagate to meta-candidate
                });
            }

            metaCandidates.sort((a, b) => {
                const countA = a.bitmaps.reduce((acc, val) => acc + ScheduleRanker.countSetBits(val), 0);
                const countB = b.bitmaps.reduce((acc, val) => acc + ScheduleRanker.countSetBits(val), 0);
                return countA - countB;
            });

            metaGroups.push({
                name: g.name,
                candidates: metaCandidates
            });
        }

        // Sort groups by size (MRV)
        metaGroups.sort((a, b) => a.candidates.length - b.candidates.length);

        const totalGroupsCount = metaGroups.length;

        // 3. Max-Subset DFS
        const topNHeap = [];
        let maxCoursesFound = 0;
        let totalFound = 0;
        const currentBitmap = Array(30).fill(0n);

        function backtrack(groupIdx, currentScheduleMeta) {
            const scheduledCount = currentScheduleMeta.length;

            if (groupIdx === totalGroupsCount) {
                if (scheduledCount > maxCoursesFound) {
                    maxCoursesFound = scheduledCount;
                    topNHeap.length = 0;
                }

                if (scheduledCount === maxCoursesFound) {
                    totalFound++;

                    const finalSchedule = currentScheduleMeta.map(m => {
                        const rep = { ...m.representative };
                        rep.alternatives = m.alternatives;
                        rep.is_skippable = m.is_skippable;
                        return rep;
                    });

                    const presentNames = new Set(finalSchedule.map(c => c.name));
                    const missingNames = [];
                    for(const mg of metaGroups) {
                        if (!presentNames.has(mg.name)) {
                            missingNames.push(mg.name);
                        }
                    }

                    const missingCount = missingNames.length;
                    const evalResult = ScheduleRanker.evaluateSchedule(finalSchedule, preferences);
                    let score = evalResult.score;

                    const penalty = missingCount * 10.0;
                    score -= penalty;

                    const entry = {
                        score,
                        schedule: finalSchedule,
                        missingNames,
                        missingCount,
                        details: evalResult.details
                    };
                    if (missingCount > 0) {
                        entry.details['缺课惩罚'] = -penalty;
                    }

                    if (topNHeap.length < maxResults) {
                        topNHeap.push(entry);
                        topNHeap.sort((a, b) => a.score - b.score);
                    } else if (score > topNHeap[0].score) {
                        topNHeap[0] = entry;
                        topNHeap.sort((a, b) => a.score - b.score);
                    }
                }
                return;
            }

            let compatibleFuture = 0;
            for (let i = groupIdx; i < totalGroupsCount; i++) {
                const group = metaGroups[i];
                // Skippable groups are always compatible because they don't check conflicts
                if (group.candidates[0].is_skippable) {
                    compatibleFuture++;
                    continue;
                }

                let canFit = false;
                for (const cand of group.candidates) {
                    let ok = true;
                    const limit = Math.min(cand.bitmaps.length, currentBitmap.length);
                    for (let w = 1; w < limit; w++) {
                        if ((cand.bitmaps[w] & currentBitmap[w]) !== 0n) {
                            ok = false;
                            break;
                        }
                    }
                    if (ok) {
                        canFit = true;
                        break;
                    }
                }
                if (canFit) compatibleFuture++;
            }

            if (scheduledCount + compatibleFuture < maxCoursesFound) {
                return;
            }

            const currentGroup = metaGroups[groupIdx];

            for (const meta of currentGroup.candidates) {
                const metaBmp = meta.bitmaps;
                const isSkippable = meta.is_skippable;
                let isValid = true;

                // If skippable, we ignore conflict checks (Ghost Mode)
                if (!isSkippable) {
                    const limit = Math.min(metaBmp.length, currentBitmap.length);
                    for (let w = 1; w < limit; w++) {
                        if ((metaBmp[w] & currentBitmap[w]) !== 0n) {
                            isValid = false;
                            break;
                        }
                    }
                }

                if (!isValid) continue;

                currentScheduleMeta.push(meta);

                // If skippable, we do NOT occupy space in currentBitmap
                if (!isSkippable) {
                    const limit = Math.min(metaBmp.length, currentBitmap.length);
                    for (let w = 1; w < limit; w++) {
                        currentBitmap[w] |= metaBmp[w];
                    }
                }

                backtrack(groupIdx + 1, currentScheduleMeta);

                currentScheduleMeta.pop();

                // Backtrack bitmap
                if (!isSkippable) {
                    const limit = Math.min(metaBmp.length, currentBitmap.length);
                    for (let w = 1; w < limit; w++) {
                        currentBitmap[w] ^= metaBmp[w];
                    }
                }
            }

            backtrack(groupIdx + 1, currentScheduleMeta);
        }

        backtrack(0, []);

        const sortedResults = topNHeap.sort((a, b) => b.score - a.score);

        const finalSchedules = sortedResults.map(item => {
            const sched = item.schedule;

            let totalCredits = 0;
            let totalHours = 0;
            let actualTotalHours = 0;
            const weekSet = new Set();
            const countedCourses = new Set();

            sched.forEach(c => {
                 if (!countedCourses.has(c.name)) {
                     totalCredits += (c.credit || 0);
                     const h = (c.hours || 0);
                     totalHours += h;
                     if (!c.is_skippable) {
                         actualTotalHours += h;
                     }
                     countedCourses.add(c.name);
                 }
                 if (c.sessions) {
                     c.sessions.forEach(s => s.weeks.forEach(w => weekSet.add(w)));
                 }
            });

            const weeks = Array.from(weekSet).sort((a,b)=>a-b);
            let weekSpan = "";
            if (weeks.length > 0) {
                weekSpan = `${weeks[0]}-${weeks[weeks.length-1]}`;
            }

            return {
                score: item.score,
                score_details: item.details,
                courses: sched,
                missing_course_names: item.missingNames,
                missing_groups: [],
                stats: {
                    total_credits: totalCredits,
                    total_hours: totalHours,
                    actual_total_hours: actualTotalHours,
                    avg_weekly_hours: weeks.length > 0 ? (totalHours / weeks.length).toFixed(1) : 0,
                    actual_avg_weekly_hours: weeks.length > 0 ? (actualTotalHours / weeks.length).toFixed(1) : 0,
                    week_span: weekSpan
                }
            };
        });

        return {
            schedules: finalSchedules,
            total_found: totalFound
        };
    }
}

if (typeof window !== 'undefined') {
    window.Solver = ScheduleSolver;
    window.Ranker = ScheduleRanker;
} else if (typeof module !== 'undefined') {
    module.exports = { ScheduleSolver, ScheduleRanker };
}
