const { createApp, ref, reactive, computed, onMounted, watch } = Vue;

createApp({
    setup() {
        const currentView = ref('search'); // search, planning, results
        const loading = ref(false);
        
        const savedSearchConfig = localStorage.getItem('nju_helper_search_config');
        let initialMatchMode = 'OR';
        let initialCampus = '1';
        if (savedSearchConfig) {
            try {
                const config = JSON.parse(savedSearchConfig);
                if (config.match_mode) initialMatchMode = config.match_mode;
                if (config.campus) initialCampus = config.campus;
            } catch (e) {
                console.error("Failed to load search config", e);
            }
        }
        const searchParams = reactive({ name: '', code: '', campus: initialCampus, semester: '2026-2027-1', match_mode: initialMatchMode });
        
        watch(() => [searchParams.match_mode, searchParams.campus], ([mode, campus]) => {
            localStorage.setItem('nju_helper_search_config', JSON.stringify({ match_mode: mode, campus: campus }));
        });
        const searchResults = ref([]);
        const groups = ref([]);
        const preferences = reactive({
            avoid_early_morning: false,
            avoid_weekend: false,
            quality_sleep: false, // Avoid 9-13
            compact_half_day: false,
            compactness: 'none',
            day_max_limit_enabled: false,
            day_max_limit_value: 0,
            day_max_limit_days: [true, true, true, true, true, true, true]
        });

        const filterText = ref('');
        const hasSearched = ref(false);

        const expandedSearchGroups = reactive({});
        const expandedGroupCandidates = reactive({});

        const normalizeCode = (code) => (code || '').trim().replace(/[A-Za-z]+$/, '');

        const isFreeTime = (course) => !!(course && course.location_text && course.location_text.includes('自由时间'));

        const getCombinedCode = (courses, normCode) => {
            if (!courses || courses.length === 0) return normCode;
            const suffixes = Array.from(new Set(courses.map(c => (c.code || '').trim().slice(normCode.length))))
                .filter(s => s !== undefined && s !== null)
                .sort();
            
            if (suffixes.length === 1 && suffixes[0] === '') {
                return normCode;
            }
            
            const hasEmpty = suffixes.includes('');
            const nonEmpty = suffixes.filter(Boolean);
            
            if (hasEmpty) {
                return normCode + '/' + nonEmpty.join('/');
            } else {
                return normCode + nonEmpty.join('/');
            }
        };

        const parseCourseTime = (locationText) => {
            if (!locationText) return "未知时间";
            const regexCh = /周([一二三四五六日天])\s*(\d+)-(\d+)节/g;
            const segments = locationText.split(/[,;]/);
            const parsedSlots = [];
            
            for (const seg of segments) {
                const isOdd = seg.includes("(单)");
                const isEven = seg.includes("(双)");
                
                regexCh.lastIndex = 0;
                let m = regexCh.exec(seg);
                if (m !== null) {
                    parsedSlots.push({
                        weekday: m[1],
                        start: m[2],
                        end: m[3],
                        isOdd: isOdd,
                        isEven: isEven
                    });
                    while ((m = regexCh.exec(seg)) !== null) {
                        parsedSlots.push({
                            weekday: m[1],
                            start: m[2],
                            end: m[3],
                            isOdd: isOdd,
                            isEven: isEven
                        });
                    }
                } else {
                    if (parsedSlots.length > 0) {
                        const lastSlot = parsedSlots[parsedSlots.length - 1];
                        if (isOdd) lastSlot.isOdd = true;
                        if (isEven) lastSlot.isEven = true;
                    }
                }
            }
            
            const times = parsedSlots.map(s => {
                const suffix = s.isOdd ? '(单)' : (s.isEven ? '(双)' : '');
                return `周${s.weekday} ${s.start}-${s.end}节${suffix}`;
            });
            const uniqueTimes = Array.from(new Set(times));
            return uniqueTimes.length > 0 ? uniqueTimes.join(', ') : "未知时间";
        };

        const groupedSearchResults = computed(() => {
            const list = filteredSearchResults.value;
            const groupsMap = new Map();
            list.forEach((c, index) => {
                const normCode = normalizeCode(c.code);
                const key = c.name + '|' + normCode;
                if (!groupsMap.has(key)) {
                    groupsMap.set(key, {
                        id: key,
                        name: c.name,
                        code: normCode,
                        courses: []
                    });
                }
                c._originalIndex = index;
                groupsMap.get(key).courses.push(c);
            });

            return Array.from(groupsMap.values()).map(g => {
                const allChecked = g.courses.every(c => c.checked);
                const someChecked = g.courses.some(c => c.checked);
                
                const pairs = g.courses.map(c => {
                    const time = parseCourseTime(c.location_text);
                    return `${c.teacher || '无老师'}(${time})`;
                });
                const uniquePairs = Array.from(new Set(pairs));
                const pairsSummary = uniquePairs.slice(0, 3).join(', ') + (uniquePairs.length > 3 ? '...' : '');
                
                const combinedCode = getCombinedCode(g.courses, g.code);
                
                return {
                    id: g.id,
                    name: g.name,
                    code: combinedCode,
                    courses: g.courses,
                    checked: allChecked,
                    indeterminate: someChecked && !allChecked,
                    pairsSummary,
                    expanded: !!expandedSearchGroups[g.id]
                };
            });
        });

        const lastSearchGroupIdx = ref(-1);

        const toggleSearchGroup = (groupId, event) => {
            const list = groupedSearchResults.value;
            const index = list.findIndex(g => g.id === groupId);
            if (index === -1) return;
            
            const group = list[index];
            const nonFreeCourses = group.courses.filter(c => !isFreeTime(c));
            if (nonFreeCourses.length === 0) return;
            
            const targetState = !group.checked;
            
            if (event && event.shiftKey && lastSearchGroupIdx.value !== -1 && lastSearchGroupIdx.value < list.length) {
                const start = Math.min(lastSearchGroupIdx.value, index);
                const end = Math.max(lastSearchGroupIdx.value, index);
                for (let i = start; i <= end; i++) {
                    list[i].courses.forEach(c => {
                        if (!isFreeTime(c)) {
                            c.checked = targetState;
                        }
                    });
                }
            } else {
                nonFreeCourses.forEach(c => {
                    c.checked = targetState;
                });
            }
            lastSearchGroupIdx.value = index;
        };

        const toggleSearchGroupExpand = (groupId) => {
            expandedSearchGroups[groupId] = !expandedSearchGroups[groupId];
        };

        const getGroupedCandidates = (group, groupIndex) => {
            const groupsMap = new Map();
            group.candidates.forEach((c, index) => {
                const normCode = normalizeCode(c.code);
                const key = c.name + '|' + normCode;
                if (!groupsMap.has(key)) {
                    groupsMap.set(key, {
                        id: group.id + '|' + key,
                        name: c.name,
                        code: normCode,
                        courses: []
                    });
                }
                c._originalIndex = index;
                groupsMap.get(key).courses.push(c);
            });

            return Array.from(groupsMap.values()).map(g => {
                const allChecked = g.courses.every(c => c.selected);
                const someChecked = g.courses.some(c => c.selected);
                
                const pairs = g.courses.map(c => {
                    const time = parseCourseTime(c.location_text);
                    return `${c.teacher || '无老师'}(${time})`;
                });
                const uniquePairs = Array.from(new Set(pairs));
                const pairsSummary = uniquePairs.slice(0, 3).join(', ') + (uniquePairs.length > 3 ? '...' : '');
                
                const combinedCode = getCombinedCode(g.courses, g.code);
                
                return {
                    id: g.id,
                    name: g.name,
                    code: combinedCode,
                    courses: g.courses,
                    checked: allChecked,
                    indeterminate: someChecked && !allChecked,
                    pairsSummary,
                    expanded: !!expandedGroupCandidates[g.id]
                };
            });
        };

        const lastGroupCandidateIdx = reactive({});

        const toggleGroupCandidateSelect = (group, groupIndex, cardId, event) => {
            const list = getGroupedCandidates(group, groupIndex);
            const index = list.findIndex(g => g.id === cardId);
            if (index === -1) return;
            
            const card = list[index];
            const targetState = !card.checked;
            
            const lastIdx = lastGroupCandidateIdx[group.id] ?? -1;
            
            if (event && event.shiftKey && lastIdx !== -1 && lastIdx < list.length) {
                const start = Math.min(lastIdx, index);
                const end = Math.max(lastIdx, index);
                for (let i = start; i <= end; i++) {
                    list[i].courses.forEach(c => {
                        c.selected = targetState;
                    });
                }
            } else {
                card.courses.forEach(c => {
                    c.selected = targetState;
                });
            }
            lastGroupCandidateIdx[group.id] = index;
        };

        const toggleGroupCandidateExpand = (cardId) => {
            expandedGroupCandidates[cardId] = !expandedGroupCandidates[cardId];
        };

        const schedules = ref([]);
        const totalCount = ref(0);
        const currentScheduleIdx = ref(0);
        const currentWeek = ref(1);
        const showAllWeeks = ref(true);
        const toastRef = ref(null);
        const visitCount = ref(null);

        // Selection State
        const lastSearchIdx = ref(-1);
        const lastGroupSelections = reactive({}); // Map groupId -> index

        const isDraggingSearch = ref(false);
        const dragStartSearchIdx = ref(-1);
        const dragTargetStateSearch = ref(false);

        const isDraggingGroup = ref(false);
        const dragStartGroupIdx = ref(-1);
        const dragStartGroupCIdx = ref(-1);
        const dragTargetStateGroup = ref(false);

        // Import Modal State
        const showImportModal = ref(false);
        const importText = ref('');
        const isImporting = ref(false);
        const importStatus = ref('');
        const importParams = reactive({ semester: '2026-2027-1', campus: '1' });

        // Alternatives Modal
        const showAltModal = ref(false);
        const currentAltCourse = ref(null);

        // Custom Schedule States
        const showCustomModal = ref(false);
        const customForm = reactive({
            name: '',
            timeText: '',
            comment: '',
            color: '#4f46e5'
        });

        const WEEKDAY_MAP = {"一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "日": 6, "天": 6};

        const parseWeekRanges = (weekStr) => {
            const weeks = new Set();
            const parts = weekStr.split(',');
            for (const part of parts) {
                if (part.includes('-')) {
                    try {
                        const [s, e] = part.split('-').map(Number);
                        for (let w = s; w <= e; w++) {
                            weeks.add(w);
                        }
                    } catch (e) {}
                } else {
                    try {
                        const w = parseInt(part);
                        if (!isNaN(w)) weeks.add(w);
                    } catch (e) {}
                }
            }
            return Array.from(weeks).sort((a, b) => a - b);
        };

        const generateBitmap = (locationText, maxWeeks = 25) => {
            const semesterSchedule = Array(maxWeeks + 1).fill(0n);
            const sessions = [];
            if (!locationText) {
                return {
                    bitmaps: semesterSchedule.map(x => x.toString()),
                    sessions
                };
            }

            const regex = /周([a-zA-Z0-9\u4e00-\u9fa5\u9fbb\u3007\u4e00-\u9fa5])\s*(\d+)-(\d+)节\s*([0-9,-]+)周/g;
            // 注意: WEEKDAY_MAP 里面支持中文的一二三四五六日天，我们直接使用中文正则
            const regexCh = /周([一二三四五六日天])\s*(\d+)-(\d+)节\s*([0-9,-]+)周/g;
            const segments = locationText.split(/[,;]/);

            for (const seg of segments) {
                const isOddOnly = seg.includes("(单)");
                const isEvenOnly = seg.includes("(双)");
                
                let locationPart = seg;
                regexCh.lastIndex = 0;
                
                let matches = [];
                let m;
                while ((m = regexCh.exec(seg)) !== null) {
                    matches.push(m);
                }
                
                for (const match of matches) {
                    locationPart = locationPart.replace(match[0], "");
                }
                locationPart = locationPart.replace("(单)", "").replace("(双)", "").trim();

                for (const match of matches) {
                    const dayChar = match[1];
                    const startNode = parseInt(match[2]);
                    const endNode = parseInt(match[3]);
                    const weekRangeStr = match[4];

                    const dayIdx = WEEKDAY_MAP[dayChar] !== undefined ? WEEKDAY_MAP[dayChar] : 0;
                    const activeWeeks = parseWeekRanges(weekRangeStr);

                    const filteredWeeks = [];
                    for (const w of activeWeeks) {
                        if (w > 0 && w <= maxWeeks) {
                            if (isOddOnly && w % 2 === 0) continue;
                            if (isEvenOnly && w % 2 !== 0) continue;
                            filteredWeeks.push(w);
                        }
                    }

                    if (filteredWeeks.length === 0) continue;

                    sessions.push({
                        day: dayIdx,
                        start: startNode,
                        end: endNode,
                        weeks: filteredWeeks,
                        location: locationPart
                    });

                    let segmentMask = 0n;
                    for (let node = startNode; node <= endNode; node++) {
                        const bitPos = BigInt((dayIdx * 13) + (node - 1));
                        segmentMask |= (1n << bitPos);
                    }

                    for (const w of filteredWeeks) {
                        semesterSchedule[w] |= segmentMask;
                    }
                }
            }

            return {
                bitmaps: semesterSchedule.map(x => x.toString()),
                sessions
            };
        };

        const openCustomModalHandler = () => {
            customForm.name = '';
            customForm.timeText = '';
            customForm.comment = '';
            customForm.color = '#4f46e5';
            showCustomModal.value = true;
        };

        const saveCustomSchedule = () => {
            if (!customForm.name.trim()) return showToast("请输入日程名称", "error");
            if (!customForm.timeText.trim()) return showToast("请输入时间安排", "error");

            const { bitmaps, sessions } = generateBitmap(customForm.timeText);
            if (sessions.length === 0) {
                return showToast("无法解析时间，请检查格式是否正确。例如：周一 1-2节 1-16周", "error");
            }

            groups.value.push({
                id: Date.now(),
                is_custom: true,
                open: false,
                candidates: [{
                    name: customForm.name.trim(),
                    code: 'custom-' + Date.now(),
                    teacher: '本人',
                    location_text: customForm.timeText.trim(),
                    comment: customForm.comment.trim(),
                    color: customForm.color,
                    schedule_bitmaps: bitmaps,
                    sessions: sessions,
                    selected: true
                }],
                is_skippable: false
            });

            showCustomModal.value = false;
            showToast("自定义日程添加成功", "success");
        };

        const getContrastColor = (hexcolor) => {
            if (!hexcolor) return '#0d47a1';
            hexcolor = hexcolor.replace("#", "");
            if (hexcolor.length === 3) {
                hexcolor = hexcolor[0] + hexcolor[0] + hexcolor[1] + hexcolor[1] + hexcolor[2] + hexcolor[2];
            }
            const r = parseInt(hexcolor.substr(0,2), 16);
            const g = parseInt(hexcolor.substr(2,2), 16);
            const b = parseInt(hexcolor.substr(4,2), 16);
            const yiq = ((r*299)+(g*587)+(b*114))/1000;
            return (yiq >= 128) ? '#000000' : '#ffffff';
        };

        const openAlternatives = (courseData) => {
            if (!courseData || !courseData.alternatives || courseData.alternatives.length <= 1) return;
            currentAltCourse.value = courseData;
            showAltModal.value = true;
        };

        // --- Computed ---

        const filteredSearchResults = computed(() => {
            if (!filterText.value) return searchResults.value;
            const term = filterText.value.toLowerCase();
            return searchResults.value.filter(c => {
                const combined = (c.name + (c.teacher || '') + (c.location_text || '')).toLowerCase();
                return combined.includes(term);
            });
        });

        // --- Methods ---

        const showToast = (msg, type='info') => {
            const el = document.querySelector('.toast');
            if (el) {
                el.innerText = msg;
                // Reset classes
                el.className = 'toast';
                if (type === 'error') el.classList.add('error');
                if (type === 'success') el.classList.add('success');

                el.style.display = 'block';
                setTimeout(() => el.style.display = 'none', 3000);
            }
        };

        // Expose to window if needed
        window.showToast = showToast;

        const fetchCourses = async (params) => {
            // New SPA implementation: fetch from Edge Function
            // Endpoint: /search?params...
            const query = new URLSearchParams(params).toString();
            try {
                const resp = await fetch(`/search?${query}`);
                if (!resp.ok) {
                    const err = await resp.json();
                    throw new Error(err.error || resp.statusText);
                }
                return await resp.json();
            } catch (e) {
                throw e;
            }
        };

        const doSearch = async () => {
            loading.value = true;
            try {
                const res = await fetchCourses(searchParams);
                // Initialize checked as FALSE
                searchResults.value = res.map(c => ({ ...c, checked: false }));
                hasSearched.value = true;
                filterText.value = ''; // Reset filter
                lastSearchIdx.value = -1; // Reset selection anchor
                if (res.length === 0) {
                     showToast("未找到任何课程", 'info');
                } else {
                     showToast(`找到 ${res.length} 条结果`, 'success');
                }
            } catch (e) {
                showToast("搜索失败: " + e, 'error');
            } finally {
                loading.value = false;
            }
        };

        const toggleSelectAll = () => {
            const visible = filteredSearchResults.value;
            if (visible.length === 0) return;

            const nonFree = visible.filter(c => !isFreeTime(c));
            if (nonFree.length === 0) return;

            const allChecked = nonFree.every(c => c.checked);
            nonFree.forEach(c => c.checked = !allChecked);
            lastSearchIdx.value = -1;
        };

        const handleSearchItemClick = (index, event) => {
            const visible = filteredSearchResults.value;
            const course = visible[index];
            if (isFreeTime(course)) return;

            // Handle Shift+Click Range
            if (event.shiftKey && lastSearchIdx.value !== -1 && lastSearchIdx.value < visible.length) {
                const start = Math.min(lastSearchIdx.value, index);
                const end = Math.max(lastSearchIdx.value, index);
                const targetState = !visible[index].checked; 

                for (let i = start; i <= end; i++) {
                    if (!isFreeTime(visible[i])) {
                        visible[i].checked = targetState;
                    }
                }
            } else {
                // Normal toggle
                visible[index].checked = !visible[index].checked;
            }
            lastSearchIdx.value = index;
        };

        const handleGroupItemClick = (groupIndex, itemIndex, event) => {
            const group = groups.value[groupIndex];
            if (!group) return;
            const candidates = group.candidates;
            const groupId = group.id;

            const lastIdx = lastGroupSelections[groupId] ?? -1;

            if (event.shiftKey && lastIdx !== -1 && lastIdx < candidates.length) {
                const start = Math.min(lastIdx, itemIndex);
                const end = Math.max(lastIdx, itemIndex);
                const targetState = !candidates[itemIndex].selected;
                for (let i = start; i <= end; i++) {
                    candidates[i].selected = targetState;
                }
            } else {
                candidates[itemIndex].selected = !candidates[itemIndex].selected;
            }
            lastGroupSelections[groupId] = itemIndex;
        };

        const startDragSearch = (index, event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            isDraggingSearch.value = true;
            dragStartSearchIdx.value = index;
            dragTargetStateSearch.value = null; // Determine target state on move
            lastSearchIdx.value = index;
        };

        const overDragSearch = (index, event) => {
            if (!isDraggingSearch.value) return;
            const visible = filteredSearchResults.value;
            const startIdx = dragStartSearchIdx.value;
            
            if (dragTargetStateSearch.value === null) {
                dragTargetStateSearch.value = !visible[startIdx].checked;
            }
            
            const start = Math.min(startIdx, index);
            const end = Math.max(startIdx, index);
            for (let i = start; i <= end; i++) {
                visible[i].checked = dragTargetStateSearch.value;
            }
        };

        const startDragGroup = (groupIdx, cIdx, event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            isDraggingGroup.value = true;
            dragStartGroupIdx.value = groupIdx;
            dragStartGroupCIdx.value = cIdx;
            dragTargetStateGroup.value = null; // Determine target state on move
            const group = groups.value[groupIdx];
            if (group) {
                lastGroupSelections[group.id] = cIdx;
            }
        };

        const overDragGroup = (groupIdx, cIdx, event) => {
            if (!isDraggingGroup.value) return;
            if (dragStartGroupIdx.value !== groupIdx) return;
            const group = groups.value[groupIdx];
            if (!group) return;
            
            if (dragTargetStateGroup.value === null) {
                dragTargetStateGroup.value = !group.candidates[dragStartGroupCIdx.value].selected;
            }
            
            const start = Math.min(dragStartGroupCIdx.value, cIdx);
            const end = Math.max(dragStartGroupCIdx.value, cIdx);
            for (let i = start; i <= end; i++) {
                group.candidates[i].selected = dragTargetStateGroup.value;
            }
        };

        const toggleAllDays = (select) => {
            for(let i=0; i<7; i++) {
                preferences.day_max_limit_days[i] = select;
            }
        };

        const invertDays = () => {
             for(let i=0; i<7; i++) {
                preferences.day_max_limit_days[i] = !preferences.day_max_limit_days[i];
            }
        };

        // --- Touch & Drag Selection Logic ---

        const touchState = reactive({
            dragging: false,
            listType: null, // 'search' or 'group'
            groupIdx: -1,
            startIndex: -1,
            currentDragIndex: -1,
            targetState: false, // The checked state we are applying
            scrollContainer: null,
            scrollSpeed: 0,
            autoScrollTimer: null
        });

        let longPressTimer = null;

        const touchManager = {
            start: (e, type, idx, groupIdx = -1) => {
                // Only left click / single touch
                if (e.touches && e.touches.length > 1) return;

                touchState.dragging = false;
                touchState.scrollSpeed = 0;

                // Clear any existing timer
                if (longPressTimer) clearTimeout(longPressTimer);

                // Set timer for long press (e.g., 500ms)
                longPressTimer = setTimeout(() => {
                    touchManager.activate(e, type, idx, groupIdx);
                }, 500);
            },

            activate: (e, type, idx, groupIdx) => {
                touchState.dragging = true;
                touchState.listType = type;
                touchState.startIndex = idx;
                touchState.groupIdx = groupIdx;
                touchState.currentDragIndex = idx;

                // Determine initial state to apply (toggle the start item)
                let item;
                if (type === 'search') {
                    item = filteredSearchResults.value[idx];
                } else if (type === 'group') {
                    item = groups.value[groupIdx].candidates[idx];
                }

                if (item) {
                    // We toggle the start item immediately upon activation
                    // And set that as the target state for the drag
                    touchState.targetState = !((type === 'search') ? item.checked : item.selected);

                    // Apply to start item
                    if (type === 'search') item.checked = touchState.targetState;
                    else item.selected = touchState.targetState;

                    // Vibrate if available
                    if (navigator.vibrate) navigator.vibrate(50);
                }

                // Find scroll container
                // Search: .results-list (closest parent)
                // Group: Window/Body (usually) or the group body
                // We use e.target to find closest scrollable or just default
                const target = e.target;
                if (type === 'search') {
                    touchState.scrollContainer = target.closest('.results-list');
                } else {
                    // For groups, we scroll the window/body
                    touchState.scrollContainer = window;
                }

                touchManager.startAutoScroll();
            },

            move: (e) => {
                // If we moved before activation, cancel the timer
                if (!touchState.dragging) {
                     if (longPressTimer) {
                         clearTimeout(longPressTimer);
                         longPressTimer = null;
                     }
                    return;
                }

                // If dragging, prevent native scroll
                if (e.cancelable) e.preventDefault();

                const touch = e.touches[0];
                const clientY = touch.clientY;

                // 1. Auto Scroll Logic
                const winHeight = window.innerHeight;
                const topThreshold = winHeight * 0.15;
                const bottomThreshold = winHeight * 0.85;

                if (clientY < topThreshold) {
                    touchState.scrollSpeed = -1 * (1 - clientY/topThreshold) * 20; // Up
                } else if (clientY > bottomThreshold) {
                    touchState.scrollSpeed = (1 - (winHeight - clientY)/(winHeight - bottomThreshold)) * 20; // Down
                } else {
                    touchState.scrollSpeed = 0;
                }

                // 2. Selection Logic
                // Find element under finger
                const el = document.elementFromPoint(touch.clientX, touch.clientY);
                if (!el) return;

                const itemEl = el.closest('.result-item');
                if (itemEl && itemEl.dataset.index !== undefined) {
                    const newIdx = parseInt(itemEl.dataset.index);
                    if (!isNaN(newIdx) && newIdx !== touchState.currentDragIndex) {
                        touchState.currentDragIndex = newIdx;
                        touchManager.updateSelection();
                    }
                }
            },

            end: (e) => {
                if (longPressTimer) clearTimeout(longPressTimer);
                if (touchState.dragging) {
                    if (e && e.cancelable) e.preventDefault();
                }
                touchState.dragging = false;
                touchState.scrollSpeed = 0;
                if (touchState.autoScrollTimer) cancelAnimationFrame(touchState.autoScrollTimer);
            },

            updateSelection: () => {
                const start = Math.min(touchState.startIndex, touchState.currentDragIndex);
                const end = Math.max(touchState.startIndex, touchState.currentDragIndex);

                if (touchState.listType === 'search') {
                    const list = filteredSearchResults.value;
                    for (let i = start; i <= end; i++) {
                        if (list[i]) list[i].checked = touchState.targetState;
                    }
                } else if (touchState.listType === 'group') {
                    const group = groups.value[touchState.groupIdx];
                    if (group) {
                         for (let i = start; i <= end; i++) {
                            if (group.candidates[i]) group.candidates[i].selected = touchState.targetState;
                        }
                    }
                }
            },

            startAutoScroll: () => {
                const step = () => {
                    if (!touchState.dragging) return;

                    if (touchState.scrollSpeed !== 0) {
                        if (touchState.scrollContainer === window) {
                            window.scrollBy(0, touchState.scrollSpeed);
                        } else if (touchState.scrollContainer) {
                            touchState.scrollContainer.scrollTop += touchState.scrollSpeed;
                        }

                        // We also need to re-check selection as we scroll
                        // But elementFromPoint depends on screen coords, which stay roughly same if finger holds still
                        // So we should re-trigger selection update logic in the loop?
                        // Currently 'move' updates selection. If finger is static and page scrolls,
                        // the element under the finger changes! So yes.
                        // However, we don't have the 'last touch event' here easily unless we store it.
                        // Let's just rely on the user moving slightly or the next touchmove event.
                        // Actually, 'touchmove' fires continuously on some devices, but not all.
                        // Ideally we store lastTouchY/X.
                    }
                    touchState.autoScrollTimer = requestAnimationFrame(step);
                };
                step();
            }
        };


        // --- Import Logic ---

        const openImportModal = () => {
            showImportModal.value = true;
            importText.value = '';
            importStatus.value = '';
        };

        const closeImportModal = () => {
            if (isImporting.value) return;
            showImportModal.value = false;
        };

        const checkForDuplicates = (newCandidates) => {
            if (!groups.value || groups.value.length === 0) return true;
            const existingNames = new Set(groups.value.map(g => {
                const active = g.candidates.find(c => c.selected);
                return active ? active.name : (g.candidates[0] ? g.candidates[0].name : "");
            }));

            const duplicates = new Set();
            for (const cand of newCandidates) {
                if (existingNames.has(cand.name)) {
                    duplicates.add(cand.name);
                }
            }

            if (duplicates.size > 0) {
                const names = Array.from(duplicates).join(", ");
                return confirm(`检测到重复课程: [${names}] 已在现有课程组中。\n\n重复添加可能导致排课结果混乱。\n是否继续添加？`);
            }
            return true;
        };

        const startBatchImport = async () => {
            if (!importText.value) return showToast("请粘贴内容", 'error');
            isImporting.value = true;
            importStatus.value = "正在解析...";

            const lines = importText.value.split('\n');
            const validCodes = [];
            const names = [];

            // Pattern: 6+ digits, optional suffix letter
            const codePattern = /^\d{6,}[A-Za-z]?$/;

            for (let line of lines) {
                line = line.trim();
                if (!line) continue;
                // Split by spaces/tabs
                const parts = line.split(/\s+/);
                let name = '';
                if (parts.length === 0) continue;
                else if (parts.length === 1) {
                    const candidate = parts[0];
                    if (codePattern.test(candidate)) {
                        validCodes.push(candidate);
                    } else {
                        names.push(candidate);
                    }
                }
                else if (parts.length === 2) {
                    if (codePattern.test(parts[0])) {
                        validCodes.push(parts[0]);
                        names.push(parts[1]);
                    } else if (codePattern.test(parts[1])) {
                        validCodes.push(parts[1]);
                        names.push(parts[0]);
                    } else {
                        continue;
                    }
                }
                else{
                if (parts[0] === '查看' && parts.length > 1) {
                    candidate = parts[1];
                    name = parts[2];
                } else {
                    candidate = parts[0];
                    name = parts[1];
                }
                if (codePattern.test(candidate)) {
                    validCodes.push(candidate);
                }
                names.push(name);
            }
            }

            if (validCodes.length === 0) {
                importStatus.value = "未找到有效的课程编号";
                showToast("未找到有效的课程编号", 'error');
                isImporting.value = false;
                return;
            }

            importStatus.value = `找到 ${validCodes.length} 个课程，开始获取...`;
            let successCount = 0;
            let failCount = 0;

            for (let i = 0; i < validCodes.length; i++) {
                const code = validCodes[i];
                importStatus.value = `[${i+1}/${validCodes.length}] 正在搜索 ${code}...`;

                try {
                    const res = await fetchCourses({
                        code: code,
                        semester: importParams.semester,
                        campus: importParams.campus,
                        match_mode: 'OR' // irrelevant for code search usually
                    });

                    if (res && res.length > 0) {
                        const candidates = res.map(c => ({
                            ...c,
                            selected: true
                        }));

                        // Check dupe for this specific import item
                        if (!checkForDuplicates(candidates)) {
                             failCount++; // User skipped
                             continue;
                        }

                        // Create Group
                        groups.value.push({
                            id: Date.now() + i, // unique-ish id
                            open: false,
                            candidates: candidates,
                            is_skippable: false // Default
                        });
                        successCount++;
                    } else {
                        failCount++;
                    }
                } catch (e) {
                    console.error("Import error for " + code, e);
                    failCount++;
                }
            }

            showToast(`导入完成: 成功 ${successCount} 个, 未找到 ${failCount} 个`, successCount > 0 ? 'success' : 'error');
            isImporting.value = false;
            showImportModal.value = false;
            currentView.value = 'planning'; // Switch to view
        };

        const createGroup = () => {
            const selectedInSearch = searchResults.value.filter(c => c.checked);
            if (selectedInSearch.length === 0) return showToast("未选择任何课程", 'error');

            // Pre-check duplicates
            if (!checkForDuplicates(selectedInSearch)) {
                return;
            }

            // Grouping key: name + '|' + normalizeCode(code)
            const checkedKeys = new Set(selectedInSearch.map(c => c.name + '|' + normalizeCode(c.code)));

            // Filter search results to only keep courses belonging to the same cards as checked ones
            const filteredResults = searchResults.value.filter(c => {
                const key = c.name + '|' + normalizeCode(c.code);
                return checkedKeys.has(key);
            });

            // Copy filtered results, mapping checked to selected
            const candidates = filteredResults.map(c => ({
                ...c,
                selected: c.checked
            }));

            groups.value.push({
                id: Date.now(),
                open: false,
                candidates: JSON.parse(JSON.stringify(candidates)),
                is_skippable: false // Default
            });
            // Uncheck after adding
            searchResults.value.forEach(c => c.checked = false);

            showToast("已添加新课程组", 'success');
            // Stay on search view
        };

        const getGroupName = (group) => {
            const first = group.candidates.find(c => c.selected) || group.candidates[0];
            if (first) return first.name;
            return "未知课程";
        };

        const getActiveCount = (group) => group.candidates.filter(c => c.selected).length;

        const removeGroup = (idx) => groups.value.splice(idx, 1);

        const generateSchedules = async () => {
            if (groups.value.length === 0) return showToast("没有课程组", 'error');
            loading.value = true;
            try {
                if (window.Solver) {
                    const cleanGroups = JSON.parse(JSON.stringify(groups.value));
                    const res = window.Solver.generateSchedules(cleanGroups, preferences);
                    if (res.error) {
                        showToast("错误: " + res.error, 'error');
                    } else {
                        schedules.value = res.schedules;
                        totalCount.value = res.total_found;
                        currentView.value = 'results';
                        currentScheduleIdx.value = 0;
                        showToast(`成功生成 ${res.schedules.length} 个方案`, 'success');
                    }
                } else {
                    showToast("Solver module not loaded.", 'error');
                }
            } catch (e) {
                console.error(e);
                showToast("生成失败: " + e, 'error');
            } finally {
                loading.value = false;
            }
        };

        const getCell = (schIdx, week, day, node) => {
            if (!schedules.value[schIdx]) return null;
            const courses = schedules.value[schIdx].courses;
            const bitPos = BigInt(day * 13 + node);
            const mask = 1n << bitPos;

            // 1. Try to find match in CURRENT week
            for (let c of courses) {
                let weekMapStr = c.schedule_bitmaps ? c.schedule_bitmaps[week] : "0";
                if (!weekMapStr) weekMapStr = "0";
                let weekMap = 0n;
                try { weekMap = BigInt(weekMapStr); } catch (e) {}

                if ((weekMap & mask) !== 0n) {
                    let loc = "未知地点";
                    if (c.sessions) {
                        const currentPeriod = node + 1;
                        const sess = c.sessions.find(s =>
                            s.day === day &&
                            currentPeriod >= s.start &&
                            currentPeriod <= s.end &&
                            s.weeks.includes(week)
                        );
                        if (sess) loc = sess.location;
                    } else {
                        // Fallback parsing
                        let text = c.location_text || "";
                        text = text.replace(/周[一二三四五六日].+?周(\((单|双)\))?/g, '').trim();
                        text = text.replace(/^周[一二三四五六日]\s+/, '').trim();
                        if (!text || text === ',') {
                            loc = (c.location_text || "").split(' ').pop();
                        } else {
                            loc = text;
                        }
                    }
                    return {
                        name: c.name,
                        teacher: c.teacher,
                        location: loc,
                        alternatives: c.alternatives,
                        isCurrent: true,
                        is_skippable: !!c.is_skippable, // Pass to view
                        color: c.color || '',
                        textColor: getContrastColor(c.color),
                        comment: c.comment || ''
                    };
                }
            }

            // 2. If not found, and showAllWeeks is ON, check other weeks
            if (showAllWeeks.value) {
                for (let c of courses) {
                    // Check sessions first (more accurate)
                    if (c.sessions) {
                        const currentPeriod = node + 1;
                        // Find any session that covers this Day/Node, regardless of week
                        const sess = c.sessions.find(s =>
                            s.day === day &&
                            currentPeriod >= s.start &&
                            currentPeriod <= s.end
                        );
                        if (sess) {
                             return {
                                name: c.name,
                                teacher: c.teacher,
                                location: sess.location,
                                alternatives: c.alternatives,
                                isCurrent: false, // Gray out
                                is_skippable: !!c.is_skippable,
                                color: c.color || '',
                                textColor: getContrastColor(c.color),
                                comment: c.comment || ''
                             };
                        }
                    }
                    
                    if (!c.sessions && c.schedule_bitmaps) {
                         for(let w=1; w<c.schedule_bitmaps.length; w++) {
                             let wm = 0n;
                             try { wm = BigInt(c.schedule_bitmaps[w]); } catch(e){}
                             if ((wm & mask) !== 0n) {
                                 // Found in some week
                                 return {
                                    name: c.name,
                                    teacher: c.teacher,
                                    location: c.location_text, // Raw text fallback
                                    alternatives: c.alternatives,
                                    isCurrent: false,
                                    is_skippable: !!c.is_skippable,
                                    color: c.color || '',
                                    textColor: getContrastColor(c.color),
                                    comment: c.comment || ''
                                 };
                             }
                         }
                    }
                }
            }
            return null;
        };

        const downloadImage = () => {
            const el = document.getElementById('capture-area');
            if(window.html2canvas) {
                window.html2canvas(el).then((canvas) => {
                    const dataUrl = canvas.toDataURL("image/png");
                    // Browser download
                    const link = document.createElement('a');
                    link.download = 'schedule.png';
                    link.href = dataUrl;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    showToast("图片已下载");
                }).catch(e => {
                     showToast("截图失败: " + e, 'error');
                });
            }
        };

        const saveSession = () => {
            // LocalStorage implementation
            const data = {
                groups: groups.value,
                preferences: preferences
            };
            localStorage.setItem('nju_helper_session', JSON.stringify(data));
            showToast("进度已保存至浏览器缓存", 'success');
        };

        const loadSession = () => {
             const raw = localStorage.getItem('nju_helper_session');
             if (raw) {
                 try {
                     const data = JSON.parse(raw);
                     if (data.groups) {
                         groups.value = data.groups;
                         // Migration: Add is_skippable if missing
                         groups.value.forEach(g => {
                             if (g.is_skippable === undefined) {
                                 g.is_skippable = false;
                             }
                         });
                     }
                     if (data.preferences) Object.assign(preferences, data.preferences);
                     return true;
                 } catch (e) {
                     console.error("Failed to load session", e);
                 }
             }
             return false;
        };

        const newSession = () => {
            if(confirm("确定清空当前进度？")) {
                groups.value = [];
                schedules.value = [];
                currentView.value = 'search';
                searchResults.value = [];
                hasSearched.value = false;
                filterText.value = '';
                localStorage.removeItem('nju_helper_session');
            }
        };

        // Hotkey Handling
        const handleKeydown = (e) => {
            const tag = e.target.tagName.toLowerCase();
            const isInput = tag === 'input' || tag === 'textarea' || tag === 'select';

            if (e.key === 'Escape') {
                if (showImportModal.value) {
                    closeImportModal();
                    return;
                }
            }

            if (e.key === 'Enter') {
                if (showImportModal.value) {
                    if (!e.shiftKey) {
                        if (tag !== 'textarea') {
                           startBatchImport();
                        }
                    }
                    return;
                }

                if (currentView.value === 'search') {
                    // Trigger search if not in textarea
                    if (tag !== 'textarea') doSearch();
                } else if (currentView.value === 'planning') {
                    generateSchedules();
                }
            }
        };

        const fetchVisitCount = async () => {
            try {
                const resp = await fetch('/visit');
                if (resp.ok) {
                    const data = await resp.json();
                    if (data && typeof data.count === 'number') {
                        visitCount.value = data.count;
                    }
                }
            } catch (e) {
                console.error("Failed to fetch visit count", e);
            }
        };

        const init = () => {
             const loaded = loadSession();
             if (loaded && groups.value.length > 0) {
                 currentView.value = 'planning';
             }
        };

        onMounted(() => {
            window.addEventListener('keydown', handleKeydown);
            window.addEventListener('mouseup', () => {
                isDraggingSearch.value = false;
                isDraggingGroup.value = false;
            });
            init();
            fetchVisitCount();
        });

        return {
            currentView, loading, searchParams, searchResults,
            groups, preferences, schedules, totalCount, currentScheduleIdx, currentWeek,
            filterText, hasSearched, filteredSearchResults,
            doSearch, createGroup, getGroupName, getActiveCount, removeGroup,
            generateSchedules, getCell, downloadImage, saveSession, newSession, toastRef,
            toggleSelectAll, toggleAllDays, invertDays,
            showImportModal, importText, isImporting, importStatus, importParams,
            openImportModal, closeImportModal, startBatchImport,
            showAltModal, currentAltCourse, openAlternatives,
            showAllWeeks,
            handleSearchItemClick, handleGroupItemClick,
            touchManager, touchState,
            startDragSearch, overDragSearch, startDragGroup, overDragGroup,
            showCustomModal, customForm, openCustomModalHandler, saveCustomSchedule,
            groupedSearchResults, expandedSearchGroups, expandedGroupCandidates,
            toggleSearchGroup, toggleSearchGroupExpand, getGroupedCandidates,
            toggleGroupCandidateSelect, toggleGroupCandidateExpand,
            visitCount
        };
    }
}).mount('#app');
