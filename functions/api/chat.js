export async function onRequestPost(context) {
    const { request, env, waitUntil } = context;
    if (request.method === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });

    const body = await request.json();
    let { message, history = [], webData = "" } = body;

    try {
        const cacheInput = message.toLowerCase().trim();
        const cacheKey = "qa_" + await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cacheInput)).then(b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('').substring(0, 16));

        if (env.QA_DB) {
            const cachedStr = await env.QA_DB.get(cacheKey);
            if (cachedStr) {
                try {
                    const cachedData = JSON.parse(cachedStr);
                    if (cachedData.answer && cachedData.answer.length > 10) return new Response(`data: {"response": ${JSON.stringify(cachedData.answer)}}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*" } });
                } catch(e) {}
            }
        }

        let cleanHistory = [];
        for (let msg of history) {
            if (!msg.content || msg.content.trim().length < 2) continue;
            if (msg.role === 'assistant' && (msg.content.toLowerCase().includes("apologize") || msg.content.includes("hệ thống đang bận") || msg.content.includes("chưa cập nhật"))) continue;
            if (cleanHistory.length > 0 && cleanHistory[cleanHistory.length - 1].role === msg.role) cleanHistory.pop(); 
            cleanHistory.push(msg);
        }

        if (webData && webData.length > 2000) webData = webData.substring(0, 2000) + "\n...[Dữ liệu đã được thu gọn]";

        const queryVectorRes = await env.AI.run('@cf/baai/bge-m3', { text: [message] });
        const vectorMatches = await env.VECTORIZE_INDEX.query(queryVectorRes.data[0], { topK: 6, returnMetadata: true });
        
        let nhanSuContext = "";
        let diaDiemContext = "";
        let kienThucContext = "";

        vectorMatches.matches?.forEach(m => {
            const text = m.metadata?.text || "";
            if (!text) return;
            const source = m.metadata?.source;
            if (source === "NhanSu_CoQuan") nhanSuContext += text + "\n";
            else if (source === "DiaDiem_ThuTuc") diaDiemContext += text + "\n";
            else kienThucContext += text + "\n"; 
        });

        // BỘ LUẬT MỚI: ÉP XƯNG HÔ "ĐỒNG CHÍ" VÀ IN ĐẬM TẤT CẢ TÊN/CHỨC VỤ
        const systemPrompt = `Bạn là Trợ lý AI Hành chính của Đoàn Phường Tân Lập.

QUY TẮC SỐNG CÒN VỀ GIAO TIẾP VÀ TRÌNH BÀY (BẮT BUỘC TUÂN THỦ 100%):

1. NGÔN NGỮ & ĐẠI TỪ NHÂN XƯNG:
   - 100% Tiếng Việt. TUYỆT ĐỐI CẤM dùng tiếng Anh.
   - TUYỆT ĐỐI KHÔNG dùng các từ "cô", "chú", "bác", "anh", "chị", "ông", "bà" để gọi/nhắc đến cán bộ.
   - BẮT BUỘC dùng danh xưng "đồng chí" cho tất cả mọi người (Ví dụ đúng: "Đồng chí làm việc tại...", sai: "Cô làm việc tại...").

2. BẮT BUỘC IN ĐẬM BẰNG DẤU SAO (**): Bạn PHẢI bọc trong cặp dấu sao kép ** cho các thông tin sau để in đậm trên web:
   - Họ và Tên cán bộ (phải viết hoa chữ cái). Ví dụ: đồng chí **TRẦN THỊ THÙY TRANG**
   - Tất cả các Chức danh/Chức vụ. Ví dụ: **Phó CT UB MTTQVN Phường**, **Bí Thư Đoàn Phường**
   - Tầng/Phòng. Ví dụ: **Tầng 1, Phòng 110**
   - Địa chỉ làm việc. Ví dụ: **71 Nguyễn Văn Cừ, Phường Tân Lập**

3. BẢN ĐỒ: Nếu có link bản đồ, CHỈ CẦN in thẳng link URL ra ở cuối câu. TUYỆT ĐỐI KHÔNG ghi các chữ như "Link bản đồ:", "Link:", "Xem bản đồ tại:" ở phía trước.

4. THÁI ĐỘ: Vô cùng lịch sự. Luôn mở đầu câu bằng "Dạ thưa".

5. ƯU TIÊN TÌM KIẾM: Quét theo thứ tự Khối 1 -> Khối 2 -> Khối 3. Khối nào có thông tin thì trả lời luôn.

DỮ LIỆU THAM KHẢO ĐÃ PHÂN CẤP ƯU TIÊN:
[KHỐI 1 - Dữ liệu Cán bộ]:\n${nhanSuContext || "Trống"}
[KHỐI 2 - Dữ liệu Địa điểm/Thủ tục]:\n${diaDiemContext || "Trống"}
[KHỐI 3 - Dữ liệu Kiến thức chung]:\n${kienThucContext || "Trống"}
[TỪ WEBSITE]:\n${webData}`;

        const aiMessages = [{ role: "system", content: systemPrompt }, ...cleanHistory, { role: "user", content: message }];

        const stream = await env.AI.run('@cf/meta/llama-3-8b-instruct', { messages: aiMessages, stream: true });
        if (!(stream instanceof ReadableStream)) throw new Error("Stream lỗi");

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
                        if (fullAnswer.length > 10 && !fullAnswer.includes("chưa cập nhật thông tin") && !fullAnswer.toLowerCase().includes("apologize")) {
                            if (env.QA_DB) await env.QA_DB.put(cacheKey, JSON.stringify({ question: message, answer: fullAnswer, timestamp: new Date().toISOString() }));
                            if (env.GOOGLE_SCRIPT_URL) {
                                await fetch(env.GOOGLE_SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: message, answer: fullAnswer }) }).catch(() => {});
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
        return new Response(`data: {"response": "Dạ thưa quý công dân, hệ thống AI đang bận xử lý dữ liệu. Mong bạn vui lòng thử lại sau giây lát ạ!"}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*" } });
    }
}