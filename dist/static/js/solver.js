class ScheduleRanker {
    static evaluateSchedule(schedule, preferences) {
        let baseScore = 100.0;
        const details = {};
        let totalPenalty = 0.0;
        let totalBonus = 0.0;

        // 0. Merge bitmaps into fullBitmap (BigInt array)
        const fullBitmap = Array(30).fill(0n);
        for (const course of schedule) {
            const cb = course.schedule_bitmaps || [];
            for (let w = 0; w < cb.length; w++) {
                if (w < fullBitmap.length) {
                    let val = 0n;
                    try {
                        val = BigInt(cb[w]);
                    } catch (e) {
                        val = 0n;
                    }
                    fullBitmap[w] |= val;
                }
            }
        }

        // 1. Avoid Early Morning
        if (preferences.avoid_early_morning) {
            let penalty = 0;
            // Iterate weeks 1 to 25
            for (let w = 1; w <= 25; w++) {
                const mask = fullBitmap[w];
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
                if ((fullBitmap[w] & weekendMask) !== 0n) {
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
                const mask = fullBitmap[w];
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
                const mask = fullBitmap[w];
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

    static coursesConflict(courseA, courseB) {
        const bmpA = ScheduleSolver.parseBitmap(courseA.schedule_bitmaps);
        const bmpB = ScheduleSolver.parseBitmap(courseB.schedule_bitmaps);
        const length = Math.min(bmpA.length, bmpB.length);

        for (let w = 1; w < length; w++) {
            if ((bmpA[w] & bmpB[w]) !== 0n) {
                return true;
            }
        }
        return false;
    }

    // Check conflicts but return details (simplified for JS port, mostly for frontend use if needed)
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
                    conflicts.push({ group1: i, group2: j, reason: firstReason || "Unknown" });
                }
            }
        }
        return conflicts;
    }

    static generateSchedules(groups, preferences) {
        const maxResults = 20;
        preferences = preferences || {};

        // 0. Preprocess: Merge Groups
        const mergedGroupsMap = new Map();

        for (const g of groups) {
            const candidates = g.candidates || [];
            if (candidates.length === 0) continue;

            let courseName = candidates[0].name;
            if (!courseName) courseName = `__ID_${g.id}__`;

            if (!mergedGroupsMap.has(courseName)) {
                mergedGroupsMap.set(courseName, {
                    id: g.id,
                    candidates: candidates.filter(c => c.selected)
                });
            } else {
                const existing = mergedGroupsMap.get(courseName);
                const newActive = candidates.filter(c => c.selected);
                existing.candidates = existing.candidates.concat(newActive);
            }
        }

        const processedGroups = Array.from(mergedGroupsMap.values());

        // 1. Meta-Candidates
        const metaGroups = [];
        for (const g of processedGroups) {
            const active = g.candidates;
            if (active.length === 0) return { schedules: [], total_found: 0, error: "One of the groups has no selected candidates." };

            const clusters = new Map();
            for (const c of active) {
                const rawBm = c.schedule_bitmaps || [];
                const intBm = ScheduleSolver.parseBitmap(rawBm);
                // Create key from bitmap content
                const key = intBm.join(','); // Array to string key

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
                    alternatives: val.list
                });
            }

            // Sort by density (fewest bits set)
            metaCandidates.sort((a, b) => {
                const countA = a.bitmaps.reduce((acc, val) => acc + ScheduleRanker.countSetBits(val), 0);
                const countB = b.bitmaps.reduce((acc, val) => acc + ScheduleRanker.countSetBits(val), 0);
                return countA - countB;
            });

            metaGroups.push(metaCandidates);
        }

        // Sort groups by size (MRV)
        metaGroups.sort((a, b) => a.length - b.length);

        // 2. DFS
        const topNHeap = []; // Array of {score, schedule}
        let totalFound = 0;
        const currentBitmap = Array(30).fill(0n);

        function backtrack(groupIdx, currentScheduleMeta) {
            if (groupIdx === metaGroups.length) {
                totalFound++;

                // Reconstruct
                const finalSchedule = currentScheduleMeta.map(m => {
                    const rep = { ...m.representative }; // Shallow copy
                    rep.alternatives = m.alternatives;
                    return rep;
                });

                const score = ScheduleRanker.scoreSchedule(finalSchedule, preferences);
                const entry = { score, schedule: finalSchedule };

                if (topNHeap.length < maxResults) {
                    topNHeap.push(entry);
                    topNHeap.sort((a, b) => a.score - b.score); // Ascending order (min-heap like)
                } else if (score > topNHeap[0].score) {
                    topNHeap[0] = entry;
                    topNHeap.sort((a, b) => a.score - b.score);
                }
                return;
            }

            // Pruning (Optional)
            /*if (topNHeap.length === maxResults) {
                 const partialSched = currentScheduleMeta.map(m => m.representative);
                 const partialScore = ScheduleRanker.scoreSchedule(partialSched, preferences);
                 if (partialScore < topNHeap[0].score - 50) return;
            }*/

            const candidates = metaGroups[groupIdx];

            for (const meta of candidates) {
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
                //forward check
                let futureIsDead = false;

                for (let nextG = groupIdx + 1; nextG < metaGroups.length; nextG++) {
                    let nextCandidate = false;

                    for (const nextMeta of metaGroups[nextG]) {
                        let conflictFound = false;
                        const limitF = Math.min(nextMeta.bitmaps.length, currentBitmap.length);
                        // Apply
                        for (let w = 1; w < limitF; w++) {
                            if (((currentBitmap[w] | metaBmp[w]) & nextMeta.bitmaps[w]) !== 0n) {
                                conflictFound = true;
                                break;
                            }
                        }

                        if (!conflictFound) {
                            nextCandidate = true;
                            break;
                        }
                    }
                    if (!nextCandidate) {
                        futureIsDead = true;
                        break;
                    }
                }

                if (futureIsDead) continue;

                currentScheduleMeta.push(meta);

                backtrack(groupIdx + 1, currentScheduleMeta);

                // Undo
                currentScheduleMeta.pop();
                for (let w = 1; w < limit; w++) {
                    currentBitmap[w] ^= metaBmp[w]; // XOR to unset
                }
            }
        }

        backtrack(0, []);

        // Sort descending by score for output
        const sortedResults = topNHeap.sort((a, b) => b.score - a.score);

        // Enrich results with stats
        const finalSchedules = sortedResults.map(item => {
            const sched = item.schedule;
            const evalResult = ScheduleRanker.evaluateSchedule(sched, preferences);

            let totalCredits = 0;
            let totalHours = 0;
            const weekSet = new Set();

            sched.forEach(c => {
                 totalCredits += (c.credit || 0);
                 totalHours += (c.hours || 0);
                 if (c.sessions) {
                     c.sessions.forEach(s => s.weeks.forEach(w => weekSet.add(w)));
                 }
            });

            // Calculate span
            const weeks = Array.from(weekSet).sort((a,b)=>a-b);
            let weekSpan = "";
            if (weeks.length > 0) {
                // simple grouping
                // ... logic to format 1-16 etc.
                // Just using start-end for now
                weekSpan = `${weeks[0]}-${weeks[weeks.length-1]}`;
            }

            return {
                score: item.score,
                score_details: evalResult.details,
                courses: sched,
                stats: {
                    total_credits: totalCredits,
                    total_hours: totalHours,
                    avg_weekly_hours: weeks.length > 0 ? (totalHours / weeks.length).toFixed(1) : 0,
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

// Export for module use or browser global
if (typeof window !== 'undefined') {
    window.Solver = ScheduleSolver;
    window.Ranker = ScheduleRanker;
} else if (typeof module !== 'undefined') {
    module.exports = { ScheduleSolver, ScheduleRanker };
}
