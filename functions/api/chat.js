export async function onRequestPost(context) {
    const { request, env, waitUntil } = context;
    const body = await request.json();
    const message = body.message;
    const history = body.history || [];
    const webData = body.webData || ""; // MỞ CỔNG NHẬN DỮ LIỆU NHÂN SỰ TỪ WEB

    try {
        const cacheKey = "q_" + await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message.toLowerCase().trim()))
            .then(b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join(''));

        const cachedResponse = await env.RAG_CACHE.get(cacheKey);
        if (cachedResponse) {
            return new Response(`data: {"response": ${JSON.stringify(cachedResponse)}}\n\ndata: [DONE]\n\n`, {
                headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" }
            });
        }

        const procedureKeywords = ["thủ tục", "hồ sơ", "đăng ký", "chứng thực", "giấy tờ", "mẫu", "quy trình", "nghĩa vụ", "chqs", "quân sự", "dân quân", "làm sao"];
        const isProcedure = procedureKeywords.some(kw => message.toLowerCase().includes(kw));
        const vectorFilter = isProcedure ? { type: "thutuc" } : { source: "sanity" };

        const queryVectorRes = await env.AI.run('@cf/baai/bge-m3', { text: [message] });
        const vectorMatches = await env.VECTORIZE_INDEX.query(queryVectorRes.data[0], { 
            topK: 4, filter: vectorFilter, returnMetadata: true 
        });
        
        const retrievedContext = vectorMatches.matches && vectorMatches.matches.length > 0 
            ? vectorMatches.matches.map(m => m.metadata.text).join('\n\n')
            : "Dữ liệu chưa cập nhật phần này.";

        // CẤM BỊA ĐẶT TRONG PROMPT
        const systemPrompt = `Bạn là Trợ lý AI của Đoàn Phường Tân Lập. Xưng hô là "Mình" và gọi người dùng là "Bạn". Năm 2026.
Tỉnh Đắk Lắk và Phú Yên đã sáp nhập thành "Tỉnh Đắk Lắk - Phú Yên".

QUY TẮC NGHIÊM NGẶT NHẤT:
1. KHI HỎI VỀ NHÂN SỰ (Bí thư, chủ tịch, phó, cán bộ...): BẠN CHỈ ĐƯỢC PHÉP TRÍCH XUẤT TÊN TỪ MỤC [DỮ LIỆU ĐỊA PHƯƠNG]. 
2. NẾU TRONG DỮ LIỆU KHÔNG CÓ TÊN, TUYỆT ĐỐI KHÔNG ĐƯỢC TỰ BỊA RA TÊN NHƯ "Nguyễn Văn A", "Nguyễn Văn B". Hãy trả lời: "Hiện tại mình chưa được cập nhật tên của vị trí này, vui lòng liên hệ trực tiếp..."
3. Trả lời bằng Tiếng Việt.

[DỮ LIỆU ĐỊA PHƯƠNG CẬP NHẬT THEO THỜI GIAN THỰC]
DANH SÁCH NHÂN SỰ:
${webData}

THÔNG TIN KHÁC:
${retrievedContext}`;

        let aiMessages = [{ role: "system", content: systemPrompt }];
        history.forEach(msg => aiMessages.push({ role: msg.role, content: msg.content }));
        aiMessages.push({ role: "user", content: message });

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
                        if (fullAnswer.length > 30) await env.RAG_CACHE.put(cacheKey, fullAnswer, { expirationTtl: 259200 });
                        if (env.GOOGLE_SCRIPT_URL) {
                            try { fetch(env.GOOGLE_SCRIPT_URL, { method: "POST", body: JSON.stringify({ user: message, bot: fullAnswer }) }); } catch (err) {}
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
        return new Response(`data: {"response": "❌ Lỗi mạng: ${error.message}"}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
    }
}