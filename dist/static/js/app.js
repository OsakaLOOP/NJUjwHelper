const { createApp, ref, reactive, computed, onMounted } = Vue;

createApp({
    setup() {
        const currentView = ref('search'); // search, planning, results
        const loading = ref(false);
        const searchParams = reactive({ name: '', code: '', campus: '1', semester: '2025-2026-1', match_mode: 'OR' });
        const searchResults = ref([]);
        const groups = ref([]);
        const preferences = reactive({
            avoid_early_morning: false,
            avoid_weekend: false,
            compactness: 'none',
            max_daily_load: 0,
            day_max_limit_enabled: false,
            day_max_limit_value: 4,
            day_max_limit_days: [true, true, true, true, true, true, true]
        });

        const filterText = ref('');
        const hasSearched = ref(false);

        const schedules = ref([]);
        const totalCount = ref(0);
        const currentScheduleIdx = ref(0);
        const currentWeek = ref(1);
        const toastRef = ref(null);

        // Import Modal State
        const showImportModal = ref(false);
        const importText = ref('');
        const isImporting = ref(false);
        const importStatus = ref('');
        const importParams = reactive({ semester: '2025-2026-1', campus: '1' });

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
            // Endpoint: /functions/search?params...
            const query = new URLSearchParams(params).toString();
            try {
                const resp = await fetch(`/functions/search?${query}`);
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

        const startBatchImport = async () => {
            if (!importText.value) return showToast("请粘贴内容", 'error');
            isImporting.value = true;
            importStatus.value = "正在解析...";

            const lines = importText.value.split('\n');
            const validCodes = [];

            // Pattern: 6+ digits, optional suffix letter
            const codePattern = /^\d{6,}[A-Za-z]?$/;

            for (let line of lines) {
                line = line.trim();
                if (!line) continue;
                // Split by spaces/tabs
                const parts = line.split(/\s+/);

                let candidate = parts[0];
                if (parts[0] === '查看' && parts.length > 1) {
                    candidate = parts[1];
                }

                if (codePattern.test(candidate)) {
                    validCodes.push(candidate);
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
                        // Create Group
                         const candidates = res.map(c => ({
                            ...c,
                            selected: true // Auto select all for imported groups
                        }));
                        groups.value.push({
                            id: Date.now() + i, // unique-ish id
                            open: false,
                            candidates: candidates
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

            // Copy all search results, map checked to selected
            const candidates = searchResults.value.map(c => ({
                ...c,
                selected: c.checked
            }));

            groups.value.push({
                id: Date.now(),
                open: false,
                candidates: JSON.parse(JSON.stringify(candidates))
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

            for (let c of courses) {
                // schedule_bitmaps are strings now
                let weekMapStr = c.schedule_bitmaps ? c.schedule_bitmaps[week] : "0";
                if (!weekMapStr) weekMapStr = "0";

                let weekMap = 0n;
                try {
                     weekMap = BigInt(weekMapStr);
                } catch (e) {}

                if ((weekMap & mask) !== 0n) {
                    // Found the course occupying this cell
                    let loc = "未知地点";
                    if (c.sessions) {
                        const currentPeriod = node + 1;
                        const sess = c.sessions.find(s =>
                            s.day === day &&
                            currentPeriod >= s.start &&
                            currentPeriod <= s.end &&
                            s.weeks.includes(week)
                        );
                        if (sess) {
                            loc = sess.location;
                        }
                    } else {
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
                        alternatives: c.alternatives
                    };
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
                     if (data.groups) groups.value = data.groups;
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
            showAltModal, currentAltCourse, openAlternatives
        };
    }
}).mount('#app');
