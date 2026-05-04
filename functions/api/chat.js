export async function onRequestPost(context) {
    const { request, env, waitUntil } = context;
    
    // Xử lý CORS an toàn
    if (request.method === "OPTIONS") {
        return new Response(null, {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            }
        });
    }

    const body = await request.json();
    const { message, history = [], webData = "" } = body;

    try {
        // Mã Cache
        const cacheInput = message.toLowerCase().trim() + webData;
        const cacheKey = "v2_" + await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cacheInput))
            .then(b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('').substring(0, 32));

        const cached = await env.RAG_CACHE.get(cacheKey);
        if (cached) {
            return new Response(`data: {"response": ${JSON.stringify(cached)}}\n\ndata: [DONE]\n\n`, {
                headers: { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*" }
            });
        }

        const queryVectorRes = await env.AI.run('@cf/baai/bge-m3', { text: [message] });
        const vectorMatches = await env.VECTORIZE_INDEX.query(queryVectorRes.data[0], { topK: 5, returnMetadata: true });
        
        // Lấy dữ liệu từ Vector (Google Sheet + Sanity cũ)
        const retrievedContext = vectorMatches.matches?.map(m => m.metadata?.text || "").filter(t => t !== "").join('\n\n') || "";

        // PROMPT THIẾT QUÂN LUẬT: ƯU TIÊN WEB LÊN HÀNG ĐẦU
        const systemPrompt = `Bạn là Trợ lý AI của Đoàn Phường Tân Lập.
QUY TẮC TRÍCH XUẤT DỮ LIỆU NGHIÊM NGẶT:
Khi trả lời người dùng, bạn PHẢI tuân thủ thứ tự tìm kiếm dữ liệu sau đây:

1. BƯỚC 1 (ƯU TIÊN TỐI ĐA): Tìm thông tin trong mục [DỮ LIỆU TỪ WEB]. Đây là nguồn chính xác tuyệt đối về cơ cấu tổ chức, phòng ban, họ và tên cán bộ, chức vụ hiện tại. 
2. BƯỚC 2: Nếu Bước 1 KHÔNG CÓ thông tin, bạn mới được phép tìm trong mục [DỮ LIỆU TỪ GOOGLE SHEET/HỆ THỐNG] (thường là các hướng dẫn, thủ tục hành chính).
3. BƯỚC 3: Nếu cả 2 nguồn trên đều không có thông tin khớp với câu hỏi, bạn PHẢI trả lời: "Hiện tại hệ thống chưa cập nhật thông tin này."
4. LỆNH CẤM: Tuyệt đối không tự sáng tác, bịa đặt tên người (VD: Nguyễn Văn A, Trần Thị B) hoặc chức vụ. Trả lời ngắn gọn, lịch sự.

[DỮ LIỆU TỪ WEB (ƯU TIÊN 1)]:
${webData}

[DỮ LIỆU TỪ GOOGLE SHEET/HỆ THỐNG (ƯU TIÊN 2)]:
${retrievedContext}`;

        const aiMessages = [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: message }];

        const stream = await env.AI.run('@cf/meta/llama-3-8b-instruct', { messages: aiMessages, stream: true });
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const reader = stream.getReader();
        const decoder = new TextDecoder();

        waitUntil((async () => {
            let fullAnswer = "";
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        if (fullAnswer.length > 5) await env.RAG_CACHE.put(cacheKey, fullAnswer, { expirationTtl: 259200 });
                        writer.close(); break;
                    }
                    writer.write(value);
                    const lines = decoder.decode(value).split('\n');
                    for (const line of lines) {
                        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                            try { fullAnswer += JSON.parse(line.replace('data: ', '')).response; } catch(e) {}
                        }
                    }
                }
            } catch (e) { writer.close(); }
        })());

        return new Response(readable, { headers: { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*" } });

    } catch (error) {
        return new Response(`data: {"response": "⚠️ Lỗi: ${error.message}"}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*" } });
    }
}