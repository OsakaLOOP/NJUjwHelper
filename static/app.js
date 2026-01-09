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
            max_daily_load: 0
        });

        const filterText = ref('');
        const hasSearched = ref(false);

        const schedules = ref([]);
        const currentScheduleIdx = ref(0);
        const currentWeek = ref(1);
        const toastRef = ref(null);

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

        const doSearch = async () => {
            loading.value = true;
            try {
                let res;
                if (window.pywebview) {
                    res = await window.pywebview.api.search(searchParams);
                } else {
                    // Mock
                    await new Promise(r => setTimeout(r, 500));
                    res = [
                        { name: '高等数学', code: '001', teacher: '张三', location_text: '周一 1-2节 1-16周', checked: false, schedule_bitmaps: Array(26).fill(3) },
                        { name: '高等数学', code: '001', teacher: '李四', location_text: '周二 3-4节 1-16周', checked: false, schedule_bitmaps: Array(26).fill(12) }
                    ];
                }
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
            // Find first selected one to name the group, or just the first one
            const first = group.candidates.find(c => c.selected) || group.candidates[0];
            if (first) return first.name;
            return "未知课程";
        };

        const getActiveCount = (group) => group.candidates.filter(c => c.selected).length;

        const toggleCandidate = (group, idx) => {
           // No-op here if using v-model, but let's keep it or remove it.
           // Since we switch to v-model in the template, this function might become obsolete
           // OR we can keep it if we want to programmatically toggle.
           // But the previous implementation used indices.
           // The template currently calls it. I will update the template to use v-model.
           // So I can remove this function or just leave a placeholder.
           // Actually, let's just make it toggle the boolean for the candidate at that index if needed,
           // but v-model is cleaner. I'll remove it from the return object if I don't use it.
           // But to be safe, I'll update it to toggle boolean.
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

        const init = async () => {
            if (window.pywebview) {
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
                    }
                } catch (e) {
                    console.error("Init error", e);
                }
            }
        };

        onMounted(() => {
            window.addEventListener('pywebviewready', init);
            setTimeout(init, 500); // Fallback
        });

        return {
            currentView, loading, searchParams, searchResults,
            groups, preferences, schedules, currentScheduleIdx, currentWeek,
            filterText, hasSearched, filteredSearchResults,
            doSearch, createGroup, getGroupName, getActiveCount, toggleCandidate, removeGroup,
            generateSchedules, getCell, downloadImage, saveSession, newSession, toastRef,
            toggleSelectAll
        };
    }
}).mount('#app');
