export async function onRequestPost(context) {
    const { request, env, waitUntil } = context;
    const body = await request.json();
    const { message, history = [], webData = "" } = body;

    try {
        // 1. KIỂM TRA CACHE (Tiết kiệm tài nguyên)
        const cacheKey = "q_" + await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message.toLowerCase().trim()))
            .then(b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(''));

        const cached = await env.RAG_CACHE.get(cacheKey);
        if (cached) {
            return new Response(`data: {"response": ${JSON.stringify(cached)}}\n\ndata: [DONE]\n\n`, {
                headers: { "Content-Type": "text/event-stream" }
            });
        }

        // 2. TÌM KIẾM DỮ LIỆU TỪ KHO VECTOR
        const procedureKeywords = ["thủ tục", "hồ sơ", "đăng ký", "chứng thực", "nghĩa vụ", "quân sự"];
        const isProcedure = procedureKeywords.some(kw => message.toLowerCase().includes(kw));
        const vectorFilter = isProcedure ? { type: "thutuc" } : { source: "sanity" };

        const queryVectorRes = await env.AI.run('@cf/baai/bge-m3', { text: [message] });
        const vectorMatches = await env.VECTORIZE_INDEX.query(queryVectorRes.data[0], { 
            topK: 5, filter: vectorFilter, returnMetadata: true 
        });
        
        const retrievedContext = vectorMatches.matches?.map(m => m.metadata.text).join('\n\n') || "Không tìm thấy thông tin liên quan.";

        // 3. THIẾT LẬP SYSTEM PROMPT (NGHIÊM NGẶT)
        const systemPrompt = `Bạn là Trợ lý AI chính thức của Đoàn Phường Tân Lập (năm 2026).
QUY TẮC CỐT LÕI:
1. Chỉ trả lời dựa trên [DỮ LIỆU THỰC TẾ]. Tuyệt đối không bịa đặt tên cán bộ (không dùng Nguyễn Văn A, B).
2. Nếu không có tên trong dữ liệu, hãy mời người dùng liên hệ trực tiếp Đoàn phường.
3. Trả lời ngắn gọn, lịch sự bằng Tiếng Việt.

[DỮ LIỆU TỪ GIAO DIỆN WEB]:
${webData}

[DỮ LIỆU TỪ HỆ THỐNG]:
${retrievedContext}`;

        const aiMessages = [
            { role: "system", content: systemPrompt },
            ...history,
            { role: "user", content: message }
        ];

        // 4. CHẠY AI VÀ STREAM KẾT QUẢ
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
                        if (fullAnswer.length > 10) {
                            await env.RAG_CACHE.put(cacheKey, fullAnswer, { expirationTtl: 259200 }); // Lưu 3 ngày
                        }
                        writer.close();
                        break;
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

        return new Response(readable, { headers: { "Content-Type": "text/event-stream" } });

    } catch (error) {
        return new Response(`data: {"response": "⚠️ Lỗi: ${error.message}"}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
    }
}