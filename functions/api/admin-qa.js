export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const action = url.searchParams.get("action");
    const key = url.searchParams.get("key");

    if (action === "list") {
        const list = await env.QA_DB.list({ prefix: "qa_" });
        let items = [];
        for (let k of list.keys) {
            const dataStr = await env.QA_DB.get(k.name);
            if (dataStr) {
                try {
                    const data = JSON.parse(dataStr);
                    items.push({ key: k.name, ...data });
                } catch(e) {}
            }
        }
        items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        return new Response(JSON.stringify(items), { headers: { "Content-Type": "application/json" } });
    }

    if (action === "delete" && key) {
        await env.QA_DB.delete(key);
        return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
    }

    return new Response("Invalid action", { status: 400 });
}