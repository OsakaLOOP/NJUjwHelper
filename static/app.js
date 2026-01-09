const { createApp, ref, reactive, computed } = Vue;

createApp({
    setup() {
        const currentView = ref('search'); // search, planning, results
        const loading = ref(false);
        const searchParams = reactive({ name: '', code: '', campus: '1', semester: '2025-2026-1' });
        const searchResults = ref([]);
        const groups = ref([]);
        const preferences = reactive({
            avoid_early_morning: false,
            avoid_weekend: false,
            compactness: 'none',
            max_daily_load: 0
        });

        const schedules = ref([]);
        const currentScheduleIdx = ref(0);
        const currentWeek = ref(1);
        const toastRef = ref(null);

        // --- Methods ---

        const showToast = (msg) => {
            const el = document.querySelector('.toast');
            el.innerText = msg;
            el.style.display = 'block';
            setTimeout(() => el.style.display = 'none', 3000);
        };

        const doSearch = async () => {
            loading.value = true;
            try {
                // Mock or Real Call
                let res;
                if (window.pywebview) {
                    res = await window.pywebview.api.search(searchParams);
                } else {
                    // Mock
                    await new Promise(r => setTimeout(r, 500));
                    res = [
                        { name: '高等数学', code: '001', teacher: '张三', location_text: '周一 1-2节 1-16周', checked: true, schedule_bitmaps: Array(26).fill(3) }, // 3 = 1 | 2 (bits 0,1)
                        { name: '高等数学', code: '001', teacher: '李四', location_text: '周二 3-4节 1-16周', checked: true, schedule_bitmaps: Array(26).fill(12) } // 12 = 4 | 8 (bits 2,3)
                    ];
                }
                // Add checked property
                searchResults.value = res.map(c => ({ ...c, checked: true }));
            } catch (e) {
                showToast("搜索失败: " + e);
            } finally {
                loading.value = false;
            }
        };

        const createGroup = () => {
            const selected = searchResults.value.filter(c => c.checked);
            if (selected.length === 0) return showToast("未选择任何课程");

            groups.value.push({
                id: Date.now(),
                open: false,
                candidates: selected, // Store full objects
                selected_indices: selected.map((_, i) => i) // Default all active
            });
            searchResults.value = [];
            currentView.value = 'planning';
            showToast("已添加新课程组");
        };

        const getGroupName = (group) => {
            if (group.candidates.length > 0) return group.candidates[0].name;
            return "未知课程";
        };

        const getActiveCount = (group) => group.selected_indices.length;

        const toggleCandidate = (group, idx) => {
            const i = group.selected_indices.indexOf(idx);
            if (i > -1) group.selected_indices.splice(i, 1);
            else group.selected_indices.push(idx);
        };

        const removeGroup = (idx) => groups.value.splice(idx, 1);

        const generateSchedules = async () => {
            if (groups.value.length === 0) return showToast("没有课程组");
            loading.value = true;
            try {
                if (window.pywebview) {
                    // Send Clean Data (strip huge objects if needed, but pywebview handles JSON)
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
            // day: 0-6, node: 0-12. Bit pos = day*13 + node
            const bitPos = day * 13 + node;
            const mask = 1 << bitPos;

            for (let c of courses) {
                // Check bitmap for this week
                const weekMap = c.schedule_bitmaps ? c.schedule_bitmaps[week] : 0;
                if ((weekMap & mask) !== 0) {
                    return { name: c.name, location: c.location_text.split(' ')[0] }; // Simple display
                }
            }
            return null;
        };

        const downloadImage = () => {
            const el = document.getElementById('capture-area');
            html2canvas(el).then(canvas => {
                const link = document.createElement('a');
                link.download = 'schedule.png';
                link.href = canvas.toDataURL();
                link.click();
            });
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
            }
        };

        // Auto load session on start if needed?
        // Not requested, but good practice. For now manual.

        return {
            currentView, loading, searchParams, searchResults,
            groups, preferences, schedules, currentScheduleIdx, currentWeek,
            doSearch, createGroup, getGroupName, getActiveCount, toggleCandidate, removeGroup,
            generateSchedules, getCell, downloadImage, saveSession, newSession, toastRef
        };
    }
}).mount('#app');
