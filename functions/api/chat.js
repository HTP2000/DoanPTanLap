export async function onRequestPost(context) {
    const { request, env } = context;
    const body = await request.json();
    const message = body.message;
    const webData = body.webData || ""; 
    const history = body.history || []; 

    try {
        let contextText = "--- DỮ LIỆU TỪ TRANG WEB CỦA PHƯỜNG ---\n" + webData + "\n--- DỮ LIỆU TỪ GOOGLE SHEET ---\n";
        
        try {
            const kbResponse = await fetch(env.GOOGLE_SCRIPT_URL);
            if (kbResponse.ok) {
                const kbData = await kbResponse.json();
                if (Array.isArray(kbData) && kbData.length > 0) {
                    kbData.forEach(item => {
                        contextText += `- Câu hỏi/Vấn đề: ${item.question} -> Chỉ dẫn: ${item.answer}\n`;
                    });
                }
            }
        } catch (e) {
            console.log("Lỗi tải Excel");
        }

        // DÙNG THẺ <data> ĐỂ KHOANH VÙNG KIẾN THỨC, CẤM AI THOÁT RA NGOÀI
        const systemPrompt = `Bạn là Trợ lý AI của Đoàn Phường Tân Lập (Năm 2026, Tỉnh Đắk Lắk - Phú Yên).
NHIỆM VỤ TỐI THƯỢNG: TRẢ LỜI CÂU HỎI CHỈ DỰA VÀO VĂN BẢN TRONG THẺ <data> DƯỚI ĐÂY.

<data>
${contextText}
</data>

QUY TẮC KỶ LUẬT THÉP:
1. TÌM TÊN NGƯỜI CHÍNH XÁC: Khi người dùng hỏi tên Bí thư, Chủ tịch... bạn BẮT BUỘC phải đọc trong thẻ <data>. Nếu trong <data> ghi "Tên cán bộ: Trần Thị Thùy Trang. Chức vụ: Bí thư..." thì phải trả lời là Trần Thị Thùy Trang.
2. CẤM BỊA ĐẶT: TUYỆT ĐỐI KHÔNG sử dụng kiến thức bên ngoài mạng internet để tạo ra các tên như Nguyễn Thị Thanh Hằng, Thanh Tâm... 
3. TỪ CHỐI NẾU KHÔNG BIẾT: Nếu trong thẻ <data> không có thông tin, bạn CHỈ ĐƯỢC trả lời nguyên văn: "Dạ, hiện tại hệ thống chưa có thông tin về vấn đề này. Bạn vui lòng liên hệ hotline của Đoàn Phường Tân Lập để được hỗ trợ nhé."
4. ĐỊNH DẠNG: Bắt buộc in đậm tên người, tên cơ quan trong dấu ** (VD: **Trần Thị Thùy Trang**). KHÔNG dùng từ "Mình!" ở đầu câu.
5. KÈM LINK BẢN ĐỒ: Nếu có link trong <data>, chèn HTML này ở cuối: <br><br><a href="ĐIỀN_LINK" target="_blank" class="inline-block px-4 py-2 bg-blue-600 text-white font-bold rounded-xl shadow-sm hover:bg-blue-700"><i class="fa-solid fa-map-location-dot mr-2"></i> Chỉ đường ngay</a>`;

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