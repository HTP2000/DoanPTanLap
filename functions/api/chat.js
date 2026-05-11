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
        // 1. TÌM TRONG LỊCH SỬ (KV CACHE) - TĂNG TỐC ĐỘ PHẢN HỒI
        const cacheInput = message.toLowerCase().trim();
        const cacheKey = "qa_" + await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cacheInput))
            .then(b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('').substring(0, 16));

        if (env.QA_DB) {
            const cachedStr = await env.QA_DB.get(cacheKey);
            if (cachedStr) {
                try {
                    const cachedData = JSON.parse(cachedStr);
                    return new Response(`data: {"response": ${JSON.stringify(cachedData.answer)}}\n\ndata: [DONE]\n\n`, {
                        headers: { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*" }
                    });
                } catch(e) {}
            }
        }

        // 2. KÉO DỮ LIỆU TỪ GOOGLE SHEET (VECTOR DB)
        const queryVectorRes = await env.AI.run('@cf/baai/bge-m3', { text: [message] });
        const vectorMatches = await env.VECTORIZE_INDEX.query(queryVectorRes.data[0], { topK: 4, returnMetadata: true });
        
        let sheetContext = vectorMatches.matches?.map(m => m.metadata?.text || "").filter(t => t !== "").join('\n\n') || "";

        // 3. ADVANCED RAG PROMPT: KIỂM SOÁT ẢO GIÁC 99% & ĐỊNH DẠNG NGHIÊM NGẶT
        const systemPrompt = `Bạn là Trợ lý AI Hành chính của Đoàn Phường Tân Lập. Nhiệm vụ của bạn là trả lời câu hỏi của người dân dựa trên dữ liệu được cung cấp dưới đây.

THỨ TỰ ƯU TIÊN DỮ LIỆU (BẮT BUỘC TUÂN THỦ):
- ƯU TIÊN 1 (Tìm trước tiên): <WEB_DATA>
- ƯU TIÊN 2 (Nếu Web không có): <SHEET_DATA>

<WEB_DATA>
${webData}
</WEB_DATA>

<SHEET_DATA>
${sheetContext}
</SHEET_DATA>

QUY TẮC SỐNG CÒN (CHỐNG ẢO GIÁC 99%):
1. Nếu thông tin KHÔNG CÓ trong cả <WEB_DATA> và <SHEET_DATA>, bạn BẮT BUỘC phải trả lời: "Xin lỗi bạn, hệ thống dữ liệu hiện tại chưa cập nhật thông tin về vấn đề này." Tuyệt đối không tự sáng tác thêm bất cứ thông tin nào.
2. Trả lời 100% bằng tiếng Việt, ngôn từ chuẩn mực, lịch sự.

QUY TẮC ĐỊNH DẠNG TÊN CÁN BỘ (BẮT BUỘC THỰC HIỆN):
- Mỗi khi xuất hiện tên một người/cán bộ trong câu trả lời, bạn phải BỌC TÊN ĐÓ TRONG THẺ HTML và thêm từ "đồng chí" phía trước.
- CÚ PHÁP CHUẨN: đồng chí <strong style="color: #0056b3; text-transform: uppercase;">[TÊN CÁN BỘ]</strong>
- VÍ DỤ ĐÚNG 1: Bí thư Đoàn phường là đồng chí <strong style="color: #0056b3; text-transform: uppercase;">TRẦN THỊ THÙY TRANG</strong>.
- VÍ DỤ ĐÚNG 2: Bạn có thể liên hệ đồng chí <strong style="color: #0056b3; text-transform: uppercase;">NGUYỄN VĂN A</strong> - Chỉ huy trưởng.
- VÍ DỤ SAI (Tuyệt đối không dùng): TRẦN THỊ THÙY TRANG, hoặc **TRẦN THỊ THÙY TRANG**, hoặc đồng chí Trần Thị Thùy Trang.`;

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
                        // NẾU CÂU TRẢ LỜI HỢP LỆ VÀ KHÔNG PHẢI LÀ TỪ CHỐI -> LƯU LẠI
                        if (fullAnswer.length > 5 && !fullAnswer.includes("chưa cập nhật thông tin")) {
                            
                            // 4a. Lưu vào Bộ nhớ đệm KV của Cloudflare
                            if (env.QA_DB) {
                                const dataToSave = { question: message, answer: fullAnswer, timestamp: new Date().toISOString() };
                                await env.QA_DB.put(cacheKey, JSON.stringify(dataToSave));
                            }

                            // 4b. BẮN DỮ LIỆU VỀ GOOGLE SHEET (Kích hoạt hàm doPost của đồng chí)
                            if (env.GOOGLE_SCRIPT_URL) {
                                await fetch(env.GOOGLE_SCRIPT_URL, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ question: message, answer: fullAnswer })
                                });
                            }
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
        return new Response(`data: {"response": "⚠️ Hệ thống đang bận cập nhật dữ liệu. Vui lòng thử lại sau giây lát."}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*" } });
    }
}