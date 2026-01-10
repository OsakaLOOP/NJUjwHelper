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
        const currentScheduleIdx = ref(0);
        const currentWeek = ref(1);
        const toastRef = ref(null);

        // Import Modal State
        const showImportModal = ref(false);
        const importText = ref('');
        const isImporting = ref(false);
        const importStatus = ref('');
        const importParams = reactive({ semester: '2025-2026-1', campus: '1' });

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

        const showToast = (msg) => {
            const el = document.querySelector('.toast');
            if (el) {
                el.innerText = msg;
                el.style.display = 'block';
                setTimeout(() => el.style.display = 'none', 3000);
            }
        };

        const fetchCourses = async (params) => {
            if (window.pywebview) {
                return await window.pywebview.api.search(params);
            } else {
                // Mock
                await new Promise(r => setTimeout(r, 300));
                // Simple mock logic
                if (params.code === 'MISSING') return [];
                return [
                    { name: '高等数学', code: params.code || '001', teacher: '张三', location_text: '周一 1-2节 1-16周', checked: false, schedule_bitmaps: Array(26).fill(3) },
                    { name: '高等数学', code: params.code || '001', teacher: '李四', location_text: '周二 3-4节 1-16周', checked: false, schedule_bitmaps: Array(26).fill(12) }
                ];
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
            } catch (e) {
                showToast("搜索失败: " + e);
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
            if (!importText.value) return showToast("请粘贴内容");
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

            showToast(`导入完成: 成功 ${successCount} 个, 未找到 ${failCount} 个`);
            isImporting.value = false;
            showImportModal.value = false;
            currentView.value = 'planning'; // Switch to view
        };

        const createGroup = () => {
            const selectedInSearch = searchResults.value.filter(c => c.checked);
            if (selectedInSearch.length === 0) return showToast("未选择任何课程");

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

            showToast("已添加新课程组");
            // Stay on search view
        };

        const getGroupName = (group) => {
            const first = group.candidates.find(c => c.selected) || group.candidates[0];
            if (first) return first.name;
            return "未知课程";
        };

        const getActiveCount = (group) => group.candidates.filter(c => c.selected).length;

        const toggleCandidate = (group, idx) => {
           const c = group.candidates[idx];
           if (c) c.selected = !c.selected;
        };

        const removeGroup = (idx) => groups.value.splice(idx, 1);

        const generateSchedules = async () => {
            if (groups.value.length === 0) return showToast("没有课程组");
            loading.value = true;
            try {
                if (window.pywebview) {
                    const cleanGroups = JSON.parse(JSON.stringify(groups.value));
                    const res = await window.pywebview.api.generate_schedules(cleanGroups, preferences);
                    if (res.error) {
                        showToast("错误: " + res.error);
                    } else {
                        schedules.value = res.schedules;
                        currentView.value = 'results';
                        currentScheduleIdx.value = 0;
                    }
                } else {
                    // Mock
                    schedules.value = [
                        { score: 95, courses: [groups.value[0].candidates[0]] }
                    ];
                    currentView.value = 'results';
                }
            } catch (e) {
                showToast("生成失败: " + e);
            } finally {
                loading.value = false;
            }
        };

        const getCell = (schIdx, week, day, node) => {
            if (!schedules.value[schIdx]) return null;
            const courses = schedules.value[schIdx].courses;
            const bitPos = day * 13 + node;
            const mask = 1 << bitPos;

            for (let c of courses) {
                const weekMap = c.schedule_bitmaps ? c.schedule_bitmaps[week] : 0;
                if ((weekMap & mask) !== 0) {
                    return { name: c.name, location: c.location_text.split(' ')[0] };
                }
            }
            return null;
        };

        const downloadImage = () => {
            const el = document.getElementById('capture-area');
            if(window.html2canvas) {
                window.html2canvas(el).then(canvas => {
                    const link = document.createElement('a');
                    link.download = 'schedule.png';
                    link.href = canvas.toDataURL();
                    link.click();
                });
            }
        };

        const saveSession = async () => {
            if (window.pywebview) {
                await window.pywebview.api.save_session(JSON.stringify(groups.value), JSON.stringify(preferences));
                showToast("保存成功");
            }
        };

        const newSession = () => {
            if(confirm("确定清空当前进度？")) {
                groups.value = [];
                schedules.value = [];
                currentView.value = 'search';
                searchResults.value = [];
                hasSearched.value = false;
                filterText.value = '';
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
                    // In import modal
                    if (!e.shiftKey) { // Allow shift+enter for new lines if needed, or just block it?
                        if (tag !== 'textarea') {
                           startBatchImport();
                        }
                    }
                    return;
                }

                if (currentView.value === 'search') {
                    // Trigger search
                    doSearch();
                } else if (currentView.value === 'planning') {
                    // Trigger generate
                    generateSchedules();
                }
            }
        };

        let isInitialized = false;

        const init = async () => {
            if (isInitialized) return;
            isInitialized = true;

            if (!window.pywebview) {
                console.warn("pywebview API not available");
                return;
            }

        
            try {
                const data = await window.pywebview.api.load_session('last_session');
                if (data) {
                        if (data.groups) groups.value = data.groups;
                        if (data.preferences) Object.assign(preferences, data.preferences);

                        if (groups.value.length > 0) {
                            currentView.value = 'planning';
                        } else {
                            currentView.value = 'search';
                        }
                    } else {
                        console.log("No previous session data found.");
                    }
            } catch (e) {
                console.error("Init error (API call failed):", e);
            }
            waitForApi();
        };

        onMounted(() => {
            window.addEventListener('keydown', handleKeydown);
            if (window.pywebview) {
                init();
            } else {
                window.addEventListener('pywebviewready', init);
            }
        });

        return {
            currentView, loading, searchParams, searchResults,
            groups, preferences, schedules, currentScheduleIdx, currentWeek,
            filterText, hasSearched, filteredSearchResults,
            doSearch, createGroup, getGroupName, getActiveCount, toggleCandidate, removeGroup,
            generateSchedules, getCell, downloadImage, saveSession, newSession, toastRef,
            toggleSelectAll, toggleAllDays, invertDays,
            showImportModal, importText, isImporting, importStatus, importParams,
            openImportModal, closeImportModal, startBatchImport
        };
    }
}).mount('#app');
