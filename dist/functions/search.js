async function handleRequest(request) {
    const url = new URL(request.url);
    const params = url.searchParams;

    // e.g. /functions/search?campus=1&semester=2025-2026-1&name=...&code=...
    const campus = params.get('campus') || '1';
    const semester = params.get('semester') || '2025-2026-1';

    // Construct variable name for globalThis KV lookup
    // "nju_courses_1_2025-2026-1"
    const datasetKey = `nju_courses_${campus}_${semester}`;

    let dataset = null;

    // 1. Try KV/Global access
    if (typeof globalThis !== 'undefined' && globalThis[datasetKey]) {
        dataset = globalThis[datasetKey];
    }

    // 2. Fallback to file fetch (if local or not in KV)
    if (!dataset) {
        try {
             // In simulated environment or browser, we might fetch from /data/
             // Note: In real Edge Function, 'fetch' is available.
             // We assume the data file is at origin/data/...
             const dataUrl = new URL(`/data/${datasetKey}.json`, url.origin).toString();
             const resp = await fetch(dataUrl);
             if (resp.ok) {
                 dataset = await resp.json();
             }
        } catch (e) {
            // ignore
        }
    }

    if (!dataset) {
        return new Response(JSON.stringify({ error: "Dataset not found for this campus/semester" }), {
            headers: { "Content-Type": "application/json" },
            status: 404
        });
    }

    // 3. Filter Logic
    const name = (params.get('name') || '').toLowerCase().trim();
    const code = (params.get('code') || '').toLowerCase().trim();
    const matchMode = params.get('match_mode') || 'OR';

    const results = dataset.filter(item => {
        // Name Filter
        if (name) {
            const keywords = name.split(/\s+/);
            const itemName = (item.name || '').toLowerCase();
            const itemTeacher = (item.teacher || '').toLowerCase();
            const combined = itemName; // Should we search teacher too?
            // Original python code only searched Name in 'KCM' field unless custom logic.
            // But usually user expects searching teacher too if not specified?
            // Wait, Python backend: KCM (Name) only for name input.
            // However, frontend text filter does name+teacher+loc.
            // Let's stick to Name field for "name" param, but maybe be flexible?
            // The prompt said "current jwFetcher...".
            // jwFetcher searches KCM.

            if (matchMode === 'AND') {
                if (!keywords.every(k => itemName.includes(k))) return false;
            } else {
                if (!keywords.some(k => itemName.includes(k))) return false;
            }
        }

        // Code Filter
        if (code) {
             if (!(item.code || '').toLowerCase().includes(code)) return false;
        }

        return true;
    });

    // Pagination (Simple slicing)
    // The frontend currently doesn't strictly depend on server-side pagination for the SPA version
    // (it loads everything usually?), but jwFetcher did pagination.
    // However, if we return huge JSON, it might be slow.
    // But since the user said "all data stored", and we are filtering, maybe we just return all matches?
    // jwFetcher returns "all_data" list after paging internally.
    // So here we just return the filtered list.

    // Limit results if too many?
    // Let's cap at 500 to be safe, or just return all.
    // Return all is safer for "Select All" feature.

    return new Response(JSON.stringify(results), {
        headers: { "Content-Type": "application/json" },
        status: 200
    });
}

// EdgeOne entry point (listener)
if (typeof addEventListener !== 'undefined') {
  addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
  });
}
