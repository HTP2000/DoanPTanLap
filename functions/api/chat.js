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

    try {
        const body = await request.json();
        const { message, history = [], webData = "" } = body;

        const cacheInput = message.toLowerCase().trim();
        const cacheKey = "qa_" + await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cacheInput))
            .then(b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('').substring(0, 16));

        // 1. Kiểm tra bộ nhớ KV
        if (env.QA_DB) {
            const cachedStr = await env.QA_DB.get(cacheKey);
            if (cachedStr) {
                try {
                    const cachedData = JSON.parse(cachedStr);
                    return new Response(`data: {"response": ${JSON.stringify(cachedData.answer)}}\n\ndata: [DONE]\n\n`, {
                        headers: { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*" }
                    });
                } catch(e) { console.error("Lỗi đọc Cache KV"); }
            }
        }

        // 2. Tìm kiếm Vector
        let retrievedContext = "";
        if (env.VECTORIZE_INDEX) {
            try {
                const queryVectorRes = await env.AI.run('@cf/baai/bge-m3', { text: [message] });
                const vectorMatches = await env.VECTORIZE_INDEX.query(queryVectorRes.data[0], { topK: 5, returnMetadata: true });
                retrievedContext = vectorMatches.matches?.map(m => m.metadata?.text || "").filter(t => t !== "").join('\n\n') || "";
            } catch(e) { console.error("Lỗi Vector:", e); }
        }

        // 3. Prompt thiết quân luật
        const systemPrompt = `Bạn là Trợ lý AI của Đoàn Phường Tân Lập.
QUY TẮC TRÍCH XUẤT DỮ LIỆU VÀ TRÌNH BÀY NGHIÊM NGẶT:
1. ƯU TIÊN SỐ 1: Tìm thông tin trong mục [DỮ LIỆU TỪ WEB].
2. ƯU TIÊN SỐ 2: Nếu không có, tìm trong [DỮ LIỆU TỪ GOOGLE SHEET/HỆ THỐNG].
3. CÁCH XƯNG HÔ VÀ TRÌNH BÀY:
   - TUYỆT ĐỐI KHÔNG dùng các cụm từ mở đầu như "Theo thông tin trên web", "Dựa vào dữ liệu". Hãy trả lời trực tiếp.
   - BẮT BUỘC thêm từ "đồng chí" trước họ và tên của cán bộ.
   - BẮT BUỘC IN ĐẬM VÀ VIẾT HOA tên và chức vụ (Ví dụ: đồng chí **TRẦN THỊ THÙY TRANG - BÍ THƯ ĐOÀN PHƯỜNG**).
   - Khi hỏi về ĐỊA CHỈ / NƠI LÀM VIỆC, sử dụng thông tin "Địa chỉ cơ quan" kết hợp với "Phòng làm việc".
4. LỆNH CẤM: Tuyệt đối không tự sáng tác, bịa đặt. Nếu không có dữ liệu, hãy nói "Hiện tại hệ thống chưa cập nhật thông tin này".

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
                        if (fullAnswer.length > 5) {
                            try {
                                if (env.QA_DB) {
                                    await env.QA_DB.put(cacheKey, JSON.stringify({ question: message, answer: fullAnswer, timestamp: new Date().toISOString() }));
                                }
                                
                                // ĐÃ GẮN SẴN ĐƯỜNG LINK GOOGLE SCRIPT CỦA BẠN VÀO ĐÂY:
                                const GOOGLE_SHEET_URL = "https://script.google.com/macros/s/AKfycbzdXsWZTPMv0fxXnDbRWyqUCD9AahcWcoEQG6n3TCIpMux_aMcJD0Y5t0Z-xyH5NYMA/exec"; 
                                
                                if (GOOGLE_SHEET_URL.startsWith("https://")) {
                                    fetch(GOOGLE_SHEET_URL, {
                                        method: "POST", headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ question: message, answer: fullAnswer })
                                    }).catch(e => console.error("Lỗi gửi Sheet:", e));
                                }
                            } catch(err) { console.error("Lỗi lưu trữ:", err); }
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
        // Trả về lỗi an toàn để giao diện không bị sập (sẽ in màu đỏ lên khung chat nếu có lỗi thay vì trắng bóc)
        const errorMsg = JSON.stringify("⚠️ Máy chủ gặp sự cố: " + (error.message || "Lỗi không xác định"));
        return new Response(`data: {"response": ${errorMsg}}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*" } });
    }
}