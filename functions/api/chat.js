export async function onRequestPost(context) {
    const { request, env, waitUntil } = context;
    
    // Xử lý CORS
    if (request.method === "OPTIONS") {
        return new Response(null, {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            }
        });
    }

    try {
        const body = await request.json();
        const { message, history = [], webData = "" } = body;

        const cacheInput = message.toLowerCase().trim();
        const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cacheInput));
        const cacheKey = "qa_" + Array.from(new Uint8Array(hashBuffer)).map(x => x.toString(16).padStart(2, '0')).join('').substring(0, 16);

        // 1. Kiểm tra Admin KV
        if (env.QA_DB) {
            try {
                const cachedStr = await env.QA_DB.get(cacheKey);
                if (cachedStr) {
                    const cachedData = JSON.parse(cachedStr);
                    if (cachedData && cachedData.answer) {
                        return new Response(`data: {"response": ${JSON.stringify(cachedData.answer)}}\n\ndata: [DONE]\n\n`, {
                            headers: { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*" }
                        });
                    }
                }
            } catch(e) {}
        }

        // 2. Tìm kiếm Vector Database
        let retrievedContext = "";
        if (env.VECTORIZE_INDEX) {
            try {
                const queryVectorRes = await env.AI.run('@cf/baai/bge-m3', { text: [message] });
                const vectorMatches = await env.VECTORIZE_INDEX.query(queryVectorRes.data[0], { topK: 5, returnMetadata: true });
                retrievedContext = vectorMatches.matches?.map(m => m.metadata?.text || "").filter(t => t !== "").join('\n\n') || "";
            } catch(e) {}
        }

        // 3. NÃO AI: ÉP KỶ LUẬT XƯNG HÔ VÀ ĐỊA CHỈ
        const systemPrompt = `Bạn là Trợ lý AI của Đoàn Phường Tân Lập.
QUY TẮC TRÍCH XUẤT VÀ TRÌNH BÀY NGHIÊM NGẶT:
1. Tìm thông tin trong [DỮ LIỆU TỪ WEB] trước. Nếu không có mới tìm trong [DỮ LIỆU TỪ HỆ THỐNG].
2. LỆNH CẤM: TUYỆT ĐỐI KHÔNG dùng các cụm từ mở đầu như "Theo thông tin trên web", "Dựa vào dữ liệu". Hãy trả lời trực tiếp, tự nhiên.
3. BẮT BUỘC thêm từ "đồng chí" ở phía trước họ và tên của cán bộ.
4. BẮT BUỘC IN ĐẬM VÀ VIẾT HOA họ tên và chức vụ (Ví dụ: đồng chí **TRẦN THỊ THÙY TRANG - BÍ THƯ ĐOÀN PHƯỜNG**).
5. Khi người dùng hỏi về ĐỊA CHỈ / NƠI LÀM VIỆC, hãy sử dụng thông tin "Địa chỉ cơ quan" (của tổ chức lớn) kết hợp với "Phòng làm việc cụ thể" để trả lời. (Ví dụ: Đồng chí làm việc tại Đảng ủy Phường, Tầng 1 Phòng 110).
6. Tuyệt đối không bịa đặt. Nếu không có thông tin, hãy nói "Hiện tại hệ thống chưa cập nhật thông tin này".

[DỮ LIỆU TỪ WEB]:
${webData}

[DỮ LIỆU TỪ HỆ THỐNG]:
${retrievedContext}`;

        const aiMessages = [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: message }];

        // 4. Kích hoạt cỗ máy Stream ổn định nhất (Không dùng TransformStream nữa)
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
                        if (fullAnswer.length > 5) {
                            try {
                                // Lưu lịch sử vào Admin KV
                                if (env.QA_DB) {
                                    await env.QA_DB.put(cacheKey, JSON.stringify({ question: message, answer: fullAnswer, timestamp: new Date().toISOString() }));
                                }
                                // Bắn lịch sử sang Google Sheet
                                const GOOGLE_SHEET_URL = "https://script.google.com/macros/s/AKfycbzdXsWZTPMv0fxXnDbRWyqUCD9AahcWcoEQG6n3TCIpMux_aMcJD0Y5t0Z-xyH5NYMA/exec"; 
                                fetch(GOOGLE_SHEET_URL, {
                                    method: "POST", headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ question: message, answer: fullAnswer })
                                }).catch(e => {});
                            } catch(err) {}
                        }
                        writer.close(); 
                        break;
                    }
                    
                    writer.write(value);
                    
                    const lines = decoder.decode(value).split('\n');
                    for (const line of lines) {
                        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                            try {
                                const data = JSON.parse(line.replace('data: ', '').trim());
                                if (data.response) fullAnswer += data.response;
                            } catch (e) {}
                        }
                    }
                }
            } catch (e) { writer.close(); }
        })());

        return new Response(readable, { headers: { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*" } });

    } catch (error) {
        const errorMsg = JSON.stringify("⚠️ Máy chủ gặp sự cố. Vui lòng thử lại sau!");
        return new Response(`data: {"response": ${errorMsg}}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*" } });
    }
}