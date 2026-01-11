const { createApp, ref, reactive, computed, onMounted } = Vue;

createApp({
    setup() {
        const currentView = ref('search'); // search, planning, results
        const loading = ref(false);
        const searchParams = reactive({ name: '', code: '', campus: '1', semester: '2025-2026-2', match_mode: 'OR' });
        const searchResults = ref([]);
        const groups = ref([]);
        const preferences = reactive({
            avoid_early_morning: false,
            avoid_weekend: false,
            quality_sleep: false, // Avoid 9-13
            compactness: 'none',
            day_max_limit_enabled: false,
            day_max_limit_value: 0,
            day_max_limit_days: [true, true, true, true, true, true, true]
        });

        const filterText = ref('');
        const hasSearched = ref(false);

        const schedules = ref([]);
        const totalCount = ref(0);
        const currentScheduleIdx = ref(0);
        const currentWeek = ref(1);
        const showAllWeeks = ref(false);
        const toastRef = ref(null);

        // Selection State
        const lastSearchIdx = ref(-1);
        const lastGroupSelections = reactive({}); // Map groupId -> index

        // Import Modal State
        const showImportModal = ref(false);
        const importText = ref('');
        const isImporting = ref(false);
        const importStatus = ref('');
        const importParams = reactive({ semester: '2025-2026-2', campus: '1' });

        // Alternatives Modal
        const showAltModal = ref(false);
        const currentAltCourse = ref(null);

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

            const allChecked = visible.every(c => c.checked);
            visible.forEach(c => c.checked = !allChecked);
            lastSearchIdx.value = -1;
        };

        const handleSearchItemClick = (index, event) => {
            const visible = filteredSearchResults.value;
            // Handle Shift+Click Range
            if (event.shiftKey && lastSearchIdx.value !== -1 && lastSearchIdx.value < visible.length) {
                const start = Math.min(lastSearchIdx.value, index);
                const end = Math.max(lastSearchIdx.value, index);
                const targetState = !visible[index].checked; // Determine target state based on the clicked item's PRE-CLICK state (which is !checked)
                // Actually, if we use @click.prevent, the value hasn't changed yet.
                // If it's currently checked, we are unchecking it.
                // So targetState should be opposite of current state.

                for (let i = start; i <= end; i++) {
                    visible[i].checked = targetState;
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
                // Same logic: toggle based on clicked item
                const targetState = !candidates[itemIndex].selected;
                for (let i = start; i <= end; i++) {
                    candidates[i].selected = targetState;
                }
            } else {
                candidates[itemIndex].selected = !candidates[itemIndex].selected;
            }
            lastGroupSelections[groupId] = itemIndex;
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

            // Copy all search results, map checked to selected
            const candidates = searchResults.value.map(c => ({
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
                        is_skippable: !!c.is_skippable // Pass to view
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
                                is_skippable: !!c.is_skippable
                            };
                        }
                    }

                    // Fallback: scan all bitmaps (heavy but necessary if no sessions)
                    // Skip if sessions existed but didn't match (already handled above)
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
                                    is_skippable: !!c.is_skippable
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

        const init = () => {
             const loaded = loadSession();
             if (loaded && groups.value.length > 0) {
                 currentView.value = 'planning';
             }
        };

        onMounted(() => {
            window.addEventListener('keydown', handleKeydown);
            init();
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
            touchManager, touchState
        };
    }
}).mount('#app');
