class ScheduleRanker {
    static evaluateSchedule(schedule, preferences) {
        let baseScore = 100.0;
        const details = {};
        let totalPenalty = 0.0;
        let totalBonus = 0.0;

        // 0. Merge bitmaps into fullBitmap (BigInt array)
        // Also merge bitmaps for non-skippable courses into scoringBitmap
        const fullBitmap = Array(30).fill(0n);
        const scoringBitmap = Array(30).fill(0n);

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
                    }
                }
            }
        }

        // Use scoringBitmap for penalties

        // 1. Avoid Early Morning
        if (preferences.avoid_early_morning) {
            let penalty = 0;
            // Iterate weeks 1 to 25
            for (let w = 1; w <= 25; w++) {
                const mask = scoringBitmap[w];
                if (mask === 0n) continue;

                let earlyMask = 0n;
                for (let d = 0; d < 7; d++) {
                    earlyMask |= (1n << BigInt(d * 13 + 0)); // Node 1
                    earlyMask |= (1n << BigInt(d * 13 + 1)); // Node 2
                }

                if ((mask & earlyMask) !== 0n) {
                    penalty += 1;
                }
            }
            const pVal = penalty * 2.0;
            totalPenalty += pVal;
            details['早八回避'] = -pVal;
        }

        // 2. Avoid Weekend
        if (preferences.avoid_weekend) {
            let penalty = 0;
            let weekendMask = 0n;
            for (let node = 0; node < 13; node++) {
                weekendMask |= (1n << BigInt(5 * 13 + node)); // Sat
                weekendMask |= (1n << BigInt(6 * 13 + node)); // Sun
            }

            for (let w = 1; w <= 25; w++) {
                if ((scoringBitmap[w] & weekendMask) !== 0n) {
                    penalty += 1;
                }
            }
            const pVal = penalty * 2.0;
            totalPenalty += pVal;
            details['周末回避'] = -pVal;
        }

        // 3. Compactness
        if (preferences.compactness === 'high' || preferences.compactness === 'low') {
            let totalGaps = 0;
            for (let w = 1; w <= 25; w++) {
                const mask = scoringBitmap[w];
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
                const pVal = totalGaps * 0.2;
                totalPenalty += pVal;
                details['课程紧凑'] = -pVal;
            } else {
                const bVal = totalGaps * 0.2;
                totalBonus += bVal;
                details['课程分散'] = +bVal;
            }
        }


        if (preferences.day_max_limit_enabled) {
            const limitVal = preferences.day_max_limit_value ?? 4;
            let targetDays = preferences.day_max_limit_days || [];
            if (targetDays.length < 7) {
                targetDays = targetDays.concat(Array(7 - targetDays.length).fill(false));
            }

            let penalty = 0;
            for (let w = 1; w <= 25; w++) {
                const mask = scoringBitmap[w];
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
            const pVal = penalty;
            totalPenalty += pVal;
            details['特定日限制'] = -pVal;
        }

        // 5. Quality Sleep (Avoid 9-13)
        if (preferences.quality_sleep) {
            let penalty = 0;
            for (let w = 1; w <= 25; w++) {
                const mask = scoringBitmap[w];
                if (mask === 0n) continue;

                let sleepMask = 0n;
                for (let d = 0; d < 7; d++) {
                     // Node 9 to 13
                     // Nodes are 1-based in my comments, but 0-12 in bits.
                     // 1=0, 2=1, ..., 9=8, 13=12.
                     for (let n = 8; n <= 12; n++) {
                         sleepMask |= (1n << BigInt(d * 13 + n));
                     }
                }

                if ((mask & sleepMask) !== 0n) {
                    penalty += 1;
                }
            }
            const pVal = penalty * 2.0;
            totalPenalty += pVal;
            details['优质睡眠'] = -pVal;
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

        // Collect names of all groups the user INTENDED to schedule (before filtering invalid candidates)
        // This ensures that if a group is completely filtered out (e.g. all candidates are 'Ghost'/Invalid),
        // it is still counted as a "Missing Course".
        const allRequiredNames = new Set();
        groups.forEach(g => {
            if (g.candidates && g.candidates.some(c => c.selected)) {
                // Use the name of the first selected candidate, or the first candidate as fallback
                const active = g.candidates.find(c => c.selected) || g.candidates[0];
                if (active && active.name) {
                    allRequiredNames.add(active.name);
                } else {
                    allRequiredNames.add(`__ID_${g.id}__`);
                }
            }
        });

        // Helper to validate a candidate
        const isValidCandidate = (c) => {
            // Rule 1: Reject if location is "Free Time"
            if ((c.location_text || "").includes("自由时间")) return false;

            // Rule 2: Check Time Parsing
            // If time cannot be parsed (bitmap is empty or all zeros), treat as invalid immediately.
            const bmps = ScheduleSolver.parseBitmap(c.schedule_bitmaps);
            // Check if any week has a non-zero bitmap
            let hasTime = false;
            for (const b of bmps) {
                if (b > 0n) {
                    hasTime = true;
                    break;
                }
            }
            if (!hasTime) return false;

            return true;
        };

        // Filter out invalid candidates from the groups
        // We create a shallow copy of groups to avoid mutating the input in a way that affects the UI permanently if not desired,
        // but 'groups' passed here is usually a deep copy from app.js anyway.
        // Let's iterate and filter candidates on the fly.
        const cleanedGroups = groups.map(g => {
            return {
                ...g,
                candidates: g.candidates.filter(c => c.selected && isValidCandidate(c))
            };
        });

        // Use filtered groups for logic
        // A group is 'nonEmpty' only if it still has valid, selected candidates.
        const nonEmptyGroups = cleanedGroups.filter(g => g.candidates && g.candidates.length > 0);

        if (nonEmptyGroups.length === 0 && allRequiredNames.size === 0) {
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

            // Sort by density (heuristic: fewer classes first might leave more room? or opposite?)
            // Just stick to density sort
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

        // Sort groups by size (MRV - Minimum Remaining Values) to fail fast
        metaGroups.sort((a, b) => a.candidates.length - b.candidates.length);

        const totalGroupsCount = metaGroups.length;

        // 3. Max-Subset DFS
        const topNHeap = [];
        let maxCoursesFound = 0;
        let totalFound = 0;
        const currentBitmap = Array(30).fill(0n);

        function backtrack(groupIdx, currentScheduleMeta) {
            const scheduledCount = currentScheduleMeta.length;

            // Base Case: All groups processed
            if (groupIdx === totalGroupsCount) {
                // We reached a leaf. Update maxCoursesFound
                if (scheduledCount > maxCoursesFound) {
                    maxCoursesFound = scheduledCount;
                    // Clear heap because we found a better size?
                    // Usually we prefer larger schedules over higher scores of smaller schedules.
                    // Yes: "must arrange as many courses as possible first"
                    topNHeap.length = 0;
                }

                if (scheduledCount === maxCoursesFound) {
                    totalFound++;

                    // Reconstruct
                    const finalSchedule = currentScheduleMeta.map(m => {
                        const rep = { ...m.representative };
                        rep.alternatives = m.alternatives;
                        rep.is_skippable = m.is_skippable;
                        return rep;
                    });

                    // Missing Groups
                    const presentNames = new Set(finalSchedule.map(c => c.name));
                    const missingNames = [];

                    // Compare against ALL required names, not just the ones that made it into metaGroups
                    for(const reqName of allRequiredNames) {
                        if (!presentNames.has(reqName)) {
                            missingNames.push(reqName);
                        }
                    }

                    const missingCount = missingNames.length;

                    // Score
                    const evalResult = ScheduleRanker.evaluateSchedule(finalSchedule, preferences);
                    let score = evalResult.score;

                    // Apply Missing Penalty
                    // Increased penalty to ensure schedules with missing courses are ranked lower
                    const penalty = missingCount * 500.0;
                    score -= penalty;

                    const entry = {
                        score,
                        schedule: finalSchedule,
                        missingNames,
                        missingCount,
                        details: evalResult.details
                    };
                    // Add missing penalty to details for display
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

            // Pruning: Calculate Future Potential
            // Count how many future groups have AT LEAST ONE candidate compatible with currentBitmap
            let compatibleFuture = 0;
            for (let i = groupIdx; i < totalGroupsCount; i++) {
                const group = metaGroups[i];
                let canFit = false;
                for (const cand of group.candidates) {
                    // Check compatibility
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
                // Cannot possibly beat the best found size
                return;
            }

            // Branch 1: Try to pick a candidate from current group
            const currentGroup = metaGroups[groupIdx];
            let pickedSomething = false;

            for (const meta of currentGroup.candidates) {
                const metaBmp = meta.bitmaps;

                // Check Conflict
                let isValid = true;
                const limit = Math.min(metaBmp.length, currentBitmap.length);
                for (let w = 1; w < limit; w++) {
                    if ((metaBmp[w] & currentBitmap[w]) !== 0n) {
                        isValid = false;
                        break;
                    }
                }

                if (!isValid) continue;



                currentScheduleMeta.push(meta);
                // Update bitmap
                for (let w = 1; w < limit; w++) {
                    currentBitmap[w] |= metaBmp[w];
                }

                backtrack(groupIdx + 1, currentScheduleMeta);

                // Backtrack
                currentScheduleMeta.pop();
                for (let w = 1; w < limit; w++) {
                    currentBitmap[w] ^= metaBmp[w]; // Unset
                }
                pickedSomething = true;
            }


            backtrack(groupIdx + 1, currentScheduleMeta);
        }

        backtrack(0, []);

        // Sort descending
        const sortedResults = topNHeap.sort((a, b) => b.score - a.score);

        // Map to final format
        const finalSchedules = sortedResults.map(item => {
            const sched = item.schedule;

            let totalCredits = 0;
            let totalHours = 0;
            let actualTotalHours = 0;
            const weekSet = new Set();
            const countedCourses = new Set(); // Prevent double counting credits/hours for same-named courses

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
                missing_groups: [], // user didn't ask for IDs, just names in UI.
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

// Export
if (typeof window !== 'undefined') {
    window.Solver = ScheduleSolver;
    window.Ranker = ScheduleRanker;
} else if (typeof module !== 'undefined') {
    module.exports = { ScheduleSolver, ScheduleRanker };
}
