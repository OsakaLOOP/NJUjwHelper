export async function onRequest({ request, env, event }) {
    const url = new URL(request.url);
    const params = url.searchParams;

    const campus = params.get('campus') || '1';
    const semester = params.get('semester') || '2025-2026-2';

    const datasetKey = `nju_courses_${campus}_${semester.split('-').join('')}`;
    const filenameKey = `nju_courses_${campus}_${semester}`;

    let dataset = null;

    if (!dataset) {
        try {
             const dataUrl = new URL(`/data/${filenameKey}.json`, url.origin).toString();
             const resp = await fetch(dataUrl);
             if (resp.ok) {
                 dataset = await resp.json();
             }
        } catch (e) {
            return new Response(JSON.stringify({ error: "Error fetching dataset" }), {
            headers: { "Content-Type": "application/json" },
            status: 404
        });                                                                                                                      
    }
}

    if (!dataset) {
        return new Response(JSON.stringify({ error: "Dataset not found for this campus/semester" }), {
            headers: { "Content-Type": "application/json" },
            status: 404
        });
    }

    const name = (params.get('name') || '').toLowerCase().trim();
    const code = (params.get('code') || '').toLowerCase().trim();
    const matchMode = params.get('match_mode') || 'OR';

    const results = dataset.filter(item => {
        if (name) {
            const keywords = name.split(/\s+/);
            const itemName = (item.name || '').toLowerCase();
            const itemTeacher = (item.teacher || '').toLowerCase();
            const combined = itemName; 

            if (matchMode === 'AND') {
                if (!keywords.every(k => itemName.includes(k))) return false;
            } else {
                if (!keywords.some(k => itemName.includes(k))) return false;
            }
        }

        if (code) {
             if (!(item.code || '').toLowerCase().includes(code)) return false;
        }

        return true;
    });


    return new Response(JSON.stringify(results), {
        headers: { "Content-Type": "application/json" },
        status: 200
    });
}