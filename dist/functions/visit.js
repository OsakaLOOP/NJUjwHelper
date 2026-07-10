export async function onRequest({ request, params, env }) {
    try {
        if (!env.my_kv) {
            return new Response(JSON.stringify({ error: "KV namespace 'my_kv' not bound" }), {
                status: 500,
                headers: { "Content-Type": "application/json" }
            });
        }

        const cookieHeader = request.headers.get('Cookie') || '';
        const match = cookieHeader.match(/visitor_sig=([^;]+)/);
        const hasSig = !!match;

        let count = await env.my_kv.get("count");
        if (count === null) {
            count = 0;
        }
        count = Number(count);

        const headers = {
            "Content-Type": "application/json"
        };

        if (!hasSig) {
            // New visitor: increment count and set visitor_sig cookie (expires in 1 day / 86400s)
            count += 1;
            await env.my_kv.put("count", String(count));

            const sig = crypto.randomUUID();
            headers["Set-Cookie"] = `visitor_sig=${sig}; Path=/; Max-Age=86400; SameSite=Lax; HttpOnly`;
        }

        return new Response(JSON.stringify({ count }), {
            status: 200,
            headers: headers
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
}
