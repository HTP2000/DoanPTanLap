export async function onRequestPost(context) {
    const { request, env, waitUntil } = context;
    
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
        // 1. TẠO MÃ KHÓA TỪ CÂU HỎI ĐỂ TÌM TRONG KV
        const cacheInput = message.toLowerCase().trim();
        const cacheKey = "qa_" + await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cacheInput))
            .then(b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('').substring(0, 16));

        // 2. KIỂM TRA XEM CÂU TRẢ LỜI ĐÃ CÓ TRONG Ổ CỨNG CHƯA
        if (env.QA_DB) {
            const cachedStr = await env.QA_DB.get(cacheKey);
            if (cachedStr) {
                try {
                    const cachedData = JSON.parse(cachedStr);
                    // Nếu đã có, bot sẽ trả lời ngay lập tức
                    return new Response(`data: {"response": ${JSON.stringify(cachedData.answer)}}\n\ndata: [DONE]\n\n`, {
                        headers: { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*" }
                    });
                } catch(e) { console.error("Lỗi đọc Cache KV"); }
            }
        }

        // 3. NẾU CHƯA CÓ, TIẾN HÀNH HỎI AI
        const queryVectorRes = await env.AI.run('@cf/baai/bge-m3', { text: [message] });
        const vectorMatches = await env.VECTORIZE_INDEX.query(queryVectorRes.data[0], { topK: 5, returnMetadata: true });
        const retrievedContext = vectorMatches.matches?.map(m => m.metadata?.text || "").filter(t => t !== "").join('\n\n') || "";

        // THÊM QUY TẮC ĐỊNH DẠNG (IN ĐẬM, VIẾT HOA) VÀO NÃO AI
        const systemPrompt = `Bạn là Trợ lý AI của Đoàn Phường Tân Lập.
QUY TẮC TRÍCH XUẤT DỮ LIỆU NGHIÊM NGẶT:
1. ƯU TIÊN SỐ 1: Tìm thông tin trong mục [DỮ LIỆU TỪ WEB].
2. ƯU TIÊN SỐ 2: Nếu không có, tìm trong [DỮ LIỆU TỪ GOOGLE SHEET/HỆ THỐNG].
3. QUY TẮC TRÌNH BÀY: Khi trả lời tên Cán Bộ và Chức Vụ, bạn PHẢI IN ĐẬM VÀ VIẾT HOA TOÀN BỘ (Ví dụ: **TRẦN THỊ THÙY TRANG - BÍ THƯ ĐOÀN PHƯỜNG** hoặc **HOÀNG XUÂN TÚ - CHỦ TỊCH HỘI CỰU CHIẾN BINH**).
4. LỆNH CẤM: Tuyệt đối không tự sáng tác, bịa đặt tên người hoặc chức vụ. Nếu không có dữ liệu, hãy nói là chưa cập nhật.

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
                        // 4. SAU KHI AI TRẢ LỜI XONG, LƯU VÀO Ổ CỨNG KV
                        if (fullAnswer.length > 5 && env.QA_DB) {
                            const dataToSave = {
                                question: message,
                                answer: fullAnswer,
                                timestamp: new Date().toISOString()
                            };
                            await env.QA_DB.put(cacheKey, JSON.stringify(dataToSave));
                        }
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