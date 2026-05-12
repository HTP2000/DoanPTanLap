export async function onRequestPost(context) {
    const { request, env, waitUntil } = context;
    
    if (request.method === "OPTIONS") {
        return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
    }

    const body = await request.json();
    const { message, history = [], webData = "" } = body;

    try {
        const cacheInput = message.toLowerCase().trim();
        const cacheKey = "qa_" + await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cacheInput)).then(b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('').substring(0, 16));

        if (env.QA_DB) {
            const cachedStr = await env.QA_DB.get(cacheKey);
            if (cachedStr) {
                try {
                    const cachedData = JSON.parse(cachedStr);
                    return new Response(`data: {"response": ${JSON.stringify(cachedData.answer)}}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*" } });
                } catch(e) {}
            }
        }

        const queryVectorRes = await env.AI.run('@cf/baai/bge-m3', { text: [message] });
        const vectorMatches = await env.VECTORIZE_INDEX.query(queryVectorRes.data[0], { topK: 4, returnMetadata: true });
        
        let sheetContext = vectorMatches.matches?.map(m => m.metadata?.text || "").filter(t => t !== "").join('\n\n') || "";

        // NÂNG CẤP PROMPT: BỘ QUY TẮC THÉP CHỐNG TIẾNG ANH & ÉP ĐỊNH DẠNG
        const systemPrompt = `Bạn là Trợ lý AI Hành chính của Đoàn Phường Tân Lập. Hãy tuân thủ TUYỆT ĐỐI các quy tắc SỐNG CÒN sau:

QUY TẮC 1 - NGÔN NGỮ (CẤM TIẾNG ANH):
- BẮT BUỘC 100% giao tiếp bằng Tiếng Việt.
- TUYỆT ĐỐI KHÔNG SỬ DỤNG TIẾNG ANH trong bất kỳ hoàn cảnh nào. Không được dùng các cụm từ như "I apologize", "Sorry", "According to the data". 
- Nếu bạn trả lời sai và cần xin lỗi, phải nói: "Dạ, hệ thống xin lỗi vì sự nhầm lẫn..."

QUY TẮC 2 - ĐỊNH DẠNG TÊN CÁN BỘ:
- Cứ nhắc đến tên cán bộ là BẮT BUỘC phải có chữ "đồng chí" phía trước và bọc tên bằng thẻ HTML.
- Cú pháp CHUẨN: đồng chí <strong style="color: #0056b3; text-transform: uppercase;">[TÊN NGƯỜI]</strong>.
- NGHIÊM CẤM dùng dấu sao (**) để in đậm. (Ví dụ sai: **TRẦN THỊ THÙY TRANG**).

QUY TẮC 3 - VĂN PHONG GIAO TIẾP:
- Thái độ: Vô cùng lịch sự, gần gũi. Luôn dùng "Dạ", "thưa", "kính chào quý công dân".
- Nếu không có thông tin: "Dạ rất tiếc, hệ thống chưa cập nhật thông tin này ạ."

QUY TẮC 4 - CHỈ ĐƯỜNG:
- Nếu người dân bảo "chỉ đường", hãy tìm "Link bản đồ" trong dữ liệu và gửi: "Dạ, gửi bạn link Google Maps để di chuyển ạ: [Link]"

DỮ LIỆU CỦA BẠN:
<WEB_DATA>\n${webData}\n</WEB_DATA>
<SHEET_DATA>\n${sheetContext}\n</SHEET_DATA>`;

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
                        // Lưu lịch sử nếu câu trả lời tiếng Việt và không phải là từ chối
                        if (fullAnswer.length > 5 && !fullAnswer.includes("chưa cập nhật thông tin") && !fullAnswer.toLowerCase().includes("apologize")) {
                            if (env.QA_DB) await env.QA_DB.put(cacheKey, JSON.stringify({ question: message, answer: fullAnswer, timestamp: new Date().toISOString() }));
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
        return new Response(`data: {"response": "Dạ thưa, hệ thống đang bận cập nhật dữ liệu một chút. Mong quý công dân thử lại sau giây lát ạ."}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*" } });
    }
}