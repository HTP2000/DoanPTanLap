export async function onRequestPost(context) {
    const { request, env } = context;
    const body = await request.json();
    const message = body.message;
    const webData = body.webData || ""; 
    const history = body.history || []; 

    try {
        let contextText = "--- DỮ LIỆU DANH BẠ VÀ ĐỊA ĐIỂM (CHÍNH XÁC 100%) ---\n" + webData + "\n--- KIẾN THỨC THỦ TỤC ---\n";
        
        try {
            const kbResponse = await fetch(env.GOOGLE_SCRIPT_URL);
            if (kbResponse.ok) {
                const kbData = await kbResponse.json();
                if (Array.isArray(kbData) && kbData.length > 0) {
                    kbData.forEach(item => {
                        contextText += `- Hỏi: ${item.question} -> Đáp: ${item.answer}\n`;
                    });
                }
            }
        } catch (e) {
            console.log("Lỗi tải Excel");
        }

        // LỆNH CẤM BỊA ĐẶT TUYỆT ĐỐI
        const systemPrompt = `Bạn là Trợ lý AI của Đoàn Phường Tân Lập (Năm 2026, Tỉnh Đắk Lắk - Phú Yên).

LỆNH CẤM TỐI CAO (CHỐNG ẢO GIÁC - HALLUCINATION):
1. Bạn BỊ CẤM sử dụng kiến thức có sẵn trên mạng để trả lời về tên người, chức vụ, hay địa danh. 
2. Mọi câu trả lời BẮT BUỘC phải lấy đúng từng chữ từ phần [DỮ LIỆU CỦA PHƯỜNG] bên dưới. TUYỆT ĐỐI KHÔNG tự nghĩ ra các tên người (như Nguyễn Thị Thanh Hằng, Nguyễn Thị Thanh Tâm...).
3. Nếu người dùng hỏi một thông tin mà trong [DỮ LIỆU CỦA PHƯỜNG] KHÔNG CÓ, bạn BẮT BUỘC phải nói đúng 1 câu này: "Dạ, hiện tại hệ thống chưa có thông tin về vấn đề này. Bạn vui lòng liên hệ hotline của Đoàn Phường để được hỗ trợ nhé." (Không được cố gắng bịa câu trả lời).

QUY TẮC TRÌNH BÀY:
- BẮT BUỘC In đậm (bọc trong dấu **) các Tên người, Tên cơ quan, Chức vụ. (Ví dụ: **Trần Thị Thùy Trang**, **Bí thư Đoàn Phường**).
- Trả lời 100% bằng tiếng Việt, lịch sự, ngắn gọn. Tuyệt đối không dùng chữ "Mình!" ở đầu câu.
- Nếu có link bản đồ, BẮT BUỘC thêm HTML này vào cuối: <br><br><a href="ĐIỀN_LINK" target="_blank" class="inline-block px-4 py-2 bg-blue-600 text-white font-bold rounded-xl shadow-sm hover:bg-blue-700"><i class="fa-solid fa-map-location-dot mr-2"></i> Chỉ đường ngay</a>

[DỮ LIỆU CỦA PHƯỜNG]
${contextText}`;

        let aiMessages = [{ role: "system", content: systemPrompt }];
        history.forEach(msg => aiMessages.push({ role: msg.role, content: msg.content }));
        aiMessages.push({ role: "user", content: message });

        const aiResponse = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
            messages: aiMessages
        });

        const answer = aiResponse.response;

        try {
            await fetch(env.GOOGLE_SCRIPT_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user: message, bot: answer }) 
            });
        } catch (e) {}

        return new Response(JSON.stringify({ reply: answer }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        return new Response(JSON.stringify({ reply: `❌ Lỗi: ${error.message}` }), { status: 500 });
    }
}