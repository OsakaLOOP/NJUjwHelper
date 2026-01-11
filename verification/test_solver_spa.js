
const fs = require('fs');
const vm = require('vm');
const path = require('path');

// Load Solver
const solverCode = fs.readFileSync(path.join(__dirname, '../dist/static/js/solver.js'), 'utf8');
const context = { window: {}, module: { exports: {} } };
vm.runInNewContext(solverCode, context);

// Try to get from window or module.exports
const ScheduleSolver = context.window.Solver || context.module.exports.ScheduleSolver;
const ScheduleRanker = context.window.Ranker || context.module.exports.ScheduleRanker;

function runTest() {
    console.log("Starting Solver Tests...");
    let failed = false;

    // Helper to create simple course candidate
    const createCandidate = (name, weekBits) => {
        // weekBits: array of 26 ints.
        // We'll just set week 1
        const b = Array(30).fill(0n);
        b[1] = BigInt(weekBits);
        return {
            name,
            schedule_bitmaps: b.map(x=>x.toString()), // Solver expects strings often or BigInts
            selected: true,
            bitmaps: b // Mock what solver expects inside (wait, solver parses it from schedule_bitmaps)
        };
    };

    // Case 1: No Conflicts
    {
        console.log("Test Case 1: No Conflicts");
        const g1 = { id: 1, candidates: [createCandidate('A', 1)] };
        const g2 = { id: 2, candidates: [createCandidate('B', 2)] };
        const res = ScheduleSolver.generateSchedules([g1, g2], {});

        if (res.error) {
            console.error("FAIL: Unexpected error", res.error);
            failed = true;
        } else if (res.schedules.length === 0) {
            console.error("FAIL: No schedules found");
            failed = true;
        } else if (res.schedules[0].courses.length !== 2) {
            console.error("FAIL: Expected 2 courses, got", res.schedules[0].courses.length);
            failed = true;
        } else if (res.schedules[0].missing_course_names && res.schedules[0].missing_course_names.length > 0) {
             console.error("FAIL: Unexpected missing courses");
             failed = true;
        } else {
            console.log("PASS");
        }
    }

    // Case 2: Absolute Conflict
    {
        console.log("Test Case 2: Absolute Conflict");
        const g1 = { id: 1, candidates: [createCandidate('A', 1)] };
        const g2 = { id: 2, candidates: [createCandidate('B', 1)] };
        const res = ScheduleSolver.generateSchedules([g1, g2], {});

        if (res.error && res.error.includes("绝对冲突")) {
            console.log("PASS: Caught absolute conflict:", res.error);
        } else {
            console.error("FAIL: Expected absolute conflict error, got:", res);
            failed = true;
        }
    }

    // Case 3: Partial Conflict (Maximization)
    {
        console.log("Test Case 3: Partial Conflict (Maximization)");
        const g1 = { id: 1, candidates: [createCandidate('A1', 1), createCandidate('A2', 2)], name: "GroupA" };
        const g2 = { id: 2, candidates: [createCandidate('B', 1)], name: "GroupB" };
        const g3 = { id: 3, candidates: [createCandidate('C', 2)], name: "GroupC" };

        // Ensure candidates have selected=true
        g1.candidates.forEach(c => c.selected = true);
        g2.candidates.forEach(c => c.selected = true);
        g3.candidates.forEach(c => c.selected = true);

        const res = ScheduleSolver.generateSchedules([g1, g2, g3], {});

        if (res.error) {
            console.error("FAIL: Unexpected error in partial case", res.error);
            failed = true;
        } else if (res.schedules.length === 0) {
            console.error("FAIL: No schedules found");
            failed = true;
        } else {
            const top = res.schedules[0];
            console.log("Top Schedule Score:", top.score);
            console.log("Top Schedule Courses:", top.courses.length);
            console.log("Missing:", top.missing_course_names);

            if (top.courses.length !== 2) {
                console.error("FAIL: Expected 2 courses, got", top.courses.length);
                failed = true;
            }
            if (!top.missing_course_names || top.missing_course_names.length !== 1) {
                console.error("FAIL: Expected 1 missing course");
                failed = true;
            }
            // Check penalty
            // Score starts at 100.
            // Missing 1 course = -10.
            // Expected score <= 90.
            if (top.score > 90.0001) {
                console.error("FAIL: Score too high, penalty not applied?");
                failed = true;
            } else {
                console.log("PASS");
            }
        }
    }

    if (failed) process.exit(1);
}

runTest();
