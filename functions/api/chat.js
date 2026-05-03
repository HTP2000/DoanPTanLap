export async function onRequestPost(context) {
    const { request, env, waitUntil } = context;
    const body = await request.json();
    const message = body.message;
    const history = body.history || [];

    try {
        // ==========================================
        // 1. TẦNG CACHE SIÊU TỐC 0ms
        // ==========================================
        const cacheKey = "q_" + await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message.toLowerCase().trim()))
            .then(b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(''));

        const cachedResponse = await env.RAG_CACHE.get(cacheKey);

        if (cachedResponse) {
            return new Response(`data: {"response": ${JSON.stringify(cachedResponse)}}\n\ndata: [DONE]\n\n`, {
                headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" }
            });
        }

        // ==========================================
        // 2. PHÂN LOẠI CÂU HỎI (INTENT ROUTER)
        // ==========================================
        const procedureKeywords = ["thủ tục", "hồ sơ", "đăng ký", "chứng thực", "giấy tờ", "mẫu", "quy trình", "nghĩa vụ", "chqs", "quân sự", "dân quân", "làm sao"];
        const isProcedure = procedureKeywords.some(kw => message.toLowerCase().includes(kw));
        
        const vectorFilter = isProcedure ? { type: "thutuc" } : { source: "sanity" };

        // ==========================================
        // 3. TÌM KIẾM VECTOR DB CHUẨN RAG
        // ==========================================
        const queryVectorRes = await env.AI.run('@cf/baai/bge-m3', { text: [message] });
        
        const vectorMatches = await env.VECTORIZE_INDEX.query(queryVectorRes.data[0], { 
            topK: 4, 
            filter: vectorFilter,
            returnMetadata: true 
        });
        
        const cleanMatches = vectorMatches.matches.filter(m => 
    !m.metadata.text.includes("Nguyễn Văn A")
    );

const retrievedContext = cleanMatches.length > 0
    ? cleanMatches.map(m => m.metadata.text).join('\n\n')
    : "Dữ liệu địa phương không chứa thông tin này.";

        // ==========================================
        // 4. KIỂM SOÁT LLM BẰNG PROMPT
        // ==========================================
        const systemPrompt = `Bạn là Trợ lý AI thân thiện của Đoàn Phường Tân Lập. Xưng hô là "Mình" và gọi người dùng là "Bạn".
Thời gian hiện tại: Năm 2026. 
Bối cảnh: Tỉnh Đắk Lắk và Phú Yên đã sáp nhập thành "Tỉnh Đắk Lắk - Phú Yên". Không còn cấp Thành phố/Huyện.

NHIỆM VỤ CỦA BẠN:
1. NGÔN NGỮ: BẮT BUỘC TRẢ LỜI 100% BẰNG TIẾNG VIỆT, ngắn gọn, dùng Markdown.
2. NHÂN SỰ: Khi hỏi về lãnh đạo, cán bộ, bạn PHẢI tìm đúng TÊN THẬT trong [DỮ LIỆU ĐỊA PHƯƠNG] để trả lời.
3. TIẾP DIỄN: Sử dụng lịch sử chat để hiểu các câu hỏi ẩn ý (Ví dụ: "Phòng cô ấy ở đâu?" -> hiểu là đang hỏi phòng của người vừa nhắc tên).
4. KHÔNG TỰ BỊA: Nếu không có thông tin trong dữ liệu, tuyệt đối không tự sáng tác, hãy mời người dùng liên hệ hotline Đoàn phường hoặc Bộ phận một cửa.

[DỮ LIỆU ĐỊA PHƯƠNG (Chỉ dùng dữ liệu này để trả lời)]
${retrievedContext}`;

        let aiMessages = [{ role: "system", content: systemPrompt }];
        history.forEach(msg => aiMessages.push({ role: msg.role, content: msg.content }));
        aiMessages.push({ role: "user", content: message });

        // ==========================================
        // 5. STREAMING KẾT HỢP XỬ LÝ NGẦM
        // ==========================================
        // Lỗi cũ nằm ở dòng dưới này, mình đã sửa { messages } thành { messages: aiMessages }
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
                        writer.close();
                        
                        // Lưu Cache 3 ngày
                        if (fullAnswer.length > 30) {
                            await env.RAG_CACHE.put(cacheKey, fullAnswer, { expirationTtl: 259200 });
                        }

                        // Lưu lịch sử chat về Google Sheet
                        if (env.GOOGLE_SCRIPT_URL) {
                            try {
                                await fetch(env.GOOGLE_SCRIPT_URL, {
                                    method: "POST",
                                    body: JSON.stringify({ user: message, bot: fullAnswer })
                                });
                            } catch (err) { console.log("Lỗi lưu Sheet:", err); }
                        }
                        
                        break;
                    }
                    writer.write(value);
                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n');
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
        return new Response(`data: {"response": "❌ Trợ lý AI đang bận chút xíu, bạn vui lòng đợi vài giây rồi thử lại nhé: ${error.message}"}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
    }
}