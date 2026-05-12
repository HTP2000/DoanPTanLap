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

        // TĂNG TOP_K LÊN 6 ĐỂ QUÉT SÂU HƠN
        const queryVectorRes = await env.AI.run('@cf/baai/bge-m3', { text: [message] });
        const vectorMatches = await env.VECTORIZE_INDEX.query(queryVectorRes.data[0], { topK: 6, returnMetadata: true });
        
        // ====================================================================
        // BÓC TÁCH VÀ PHÂN LOẠI DỮ LIỆU THEO TỪNG SHEET ĐỂ ƯU TIÊN
        // ====================================================================
        let nhanSuContext = "";
        let diaDiemContext = "";
        let kienThucContext = "";

        vectorMatches.matches?.forEach(m => {
            const text = m.metadata?.text || "";
            if (!text) return;
            const source = m.metadata?.source;
            
            if (source === "NhanSu_CoQuan") nhanSuContext += text + "\n";
            else if (source === "DiaDiem_ThuTuc") diaDiemContext += text + "\n";
            else if (source === "KienThucNen") kienThucContext += text + "\n";
            else kienThucContext += text + "\n"; // Nếu không rõ nguồn thì gom vào kiến thức chung
        });

        // ====================================================================
        // BỘ LUẬT THÉP: ÉP BUỘC ĐỌC THEO THỨ TỰ ƯU TIÊN 1 -> 2 -> 3
        // ====================================================================
        const systemPrompt = `Bạn là Trợ lý AI Hành chính của Đoàn Phường Tân Lập.

QUY TẮC SỐNG CÒN:
1. NGÔN NGỮ: Bắt buộc 100% Tiếng Việt. TUYỆT ĐỐI CẤM dùng tiếng Anh.
2. ĐỊNH DẠNG TÊN CÁN BỘ: BẮT BUỘC thêm "đồng chí" và bọc thẻ HTML: đồng chí <strong style="color: #0056b3; text-transform: uppercase;">[TÊN CÁN BỘ]</strong>. NGHIÊM CẤM dùng dấu sao (**).
3. THÁI ĐỘ: Vô cùng lịch sự, tận tình. Luôn xưng hô "Dạ thưa", "kính chào quý công dân".
4. TÌM KIẾM THÔNG TIN (RẤT QUAN TRỌNG): Bạn BẮT BUỘC phải đọc và trả lời theo ĐÚNG thứ tự ưu tiên các khối dữ liệu dưới đây. Nếu Khối 1 có câu trả lời, lập tức dừng lại và trả lời ngay. Chỉ khi Khối 1 KHÔNG CÓ thông tin mới được phép quét tiếp Khối 2 và Khối 3.
   - Nếu không tìm thấy thông tin trong cả 3 khối, hãy nói: "Dạ rất tiếc, hệ thống chưa cập nhật thông tin này ạ." TUYỆT ĐỐI không bịa đặt.
5. BẢN ĐỒ: Nếu dân hỏi "chỉ đường" hoặc "địa chỉ", hãy gửi Link bản đồ.

DỮ LIỆU THAM KHẢO ĐÃ PHÂN CẤP ƯU TIÊN:

[KHỐI 1 - ƯU TIÊN CAO NHẤT: Dữ liệu Cán bộ & Nhân sự]
${nhanSuContext || "Không có dữ liệu nhân sự khớp với câu hỏi."}

[KHỐI 2 - ƯU TIÊN TRUNG BÌNH: Dữ liệu Địa điểm & Thủ tục]
${diaDiemContext || "Không có dữ liệu thủ tục khớp với câu hỏi."}

[KHỐI 3 - ƯU TIÊN THẤP: Dữ liệu Kiến thức nền chung]
${kienThucContext || "Không có dữ liệu kiến thức chung khớp với câu hỏi."}

[TỪ WEBSITE]:
${webData}`;

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
        return new Response(`data: {"response": "Dạ thưa quý công dân, hệ thống AI đang xử lý một lượng lớn dữ liệu nên hơi quá tải. Mong bạn vui lòng thử lại sau giây lát ạ!"}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*" } });
    }
}