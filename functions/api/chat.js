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
        if (cleanHistory.length > 0 && cleanHistory[cleanHistory.length - 1].role === 'user') cleanHistory.pop();

        const queryVectorRes = await env.AI.run('@cf/baai/bge-m3', { text: [message] });
        const vectorMatches = await env.VECTORIZE_INDEX.query(queryVectorRes.data[0], { topK: 4, returnMetadata: true });
        
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

        // ====================================================================
        // BỘ LUẬT TỐI THƯỢNG: ÉP KHUÔN MẪU KHÔNG ĐƯỢC PHÉP SAI LỆCH
        // ====================================================================
        const systemPrompt = `Bạn là Trợ lý AI Hành chính. TỪ CHỐI mọi sáng tạo. BẮT BUỘC tuân thủ 100% 3 luật sau:

1. LUẬT XƯNG HÔ (NGHIÊM CẤM VI PHẠM):
- BẤT KỲ cán bộ nào (nam hay nữ) ĐỀU PHẢI GỌI LÀ "đồng chí".
- CẤM TUYỆT ĐỐI các từ: "cô", "dì", "chú", "bác", "anh", "chị", "ông", "bà".
- Bắt buộc phải viết: "Đồng chí làm việc tại...".

2. LUẬT IN ĐẬM VÀ LINK BẢN ĐỒ (RẤT QUAN TRỌNG):
- BẠN PHẢI dùng cặp dấu sao ** bao quanh tên. VD: **TRẦN THỊ THÙY TRANG**
- BẠN PHẢI dùng cặp dấu sao ** bao quanh TOÀN BỘ chức vụ kiêm nhiệm. VD: **Phó CT UB MTTQVN Phường, Bí Thư Đoàn Phường**
- BẠN PHẢI dùng cặp dấu sao ** bao quanh Tầng/Phòng và Địa chỉ.
- CẤM TUYỆT ĐỐI việc tạo link bằng dấu ngoặc vuông ngoặc tròn kiểu []() hoặc [Bản đồ](). Chỉ được dán trực tiếp đường link thô (bắt đầu bằng https://...) thẳng vào cuối câu.

3. COPY Y HỆT MẪU VÀ VÍ DỤ SAU ĐÂY (Chỉ thay thông tin tương ứng):
MẪU CHUẨN:
"Dạ thưa, [Chức vụ] là đồng chí **[HỌ VÀ TÊN VIẾT HOA]**, **[Toàn bộ chức danh]**. Đồng chí làm việc tại **[Tầng/Phòng]**, địa chỉ **[Địa chỉ cơ quan]**. https://..."

VÍ DỤ BẠN BẮT BUỘC PHẢI BẮT CHƯỚC Y HỆT:
"Dạ thưa, Bí thư đoàn phường là đồng chí **TRẦN THỊ THÙY TRANG**, **Phó CT UB MTTQVN Phường, Bí Thư Đoàn Phường**. Đồng chí làm việc tại **Tầng 1, Phòng 110**, địa chỉ **71 Nguyễn Văn Cừ, Phường Tân Lập, Tỉnh Đắk Lắk**. https://maps.app.goo.gl/pBeaY9phwtX8DwvV7"

DỮ LIỆU CẦN XỬ LÝ:
[KHỐI 1 - Cán Bộ]:\n${nhanSuContext || "Trống"}
[KHỐI 2 - Địa Điểm]:\n${diaDiemContext || "Trống"}
[KHỐI 3 - Kiến Thức]:\n${kienThucContext || "Trống"}`;

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
        return new Response(`data: {"response": "Dạ thưa quý công dân, hệ thống đang bận xử lý. Mong bạn vui lòng thử lại sau giây lát ạ!"}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*" } });
    }
}