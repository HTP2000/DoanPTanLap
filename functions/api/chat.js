export async function onRequestPost(context) {
    const { request, env } = context;
    const body = await request.json();
    const message = body.message;
    const webData = body.webData || ""; 
    const history = body.history || []; 

    try {
        let contextText = "THÔNG TIN CHI TIẾT NHÂN SỰ VÀ ĐỊA ĐIỂM TRÊN WEB:\n" + webData + "\nKIẾN THỨC THỦ TỤC (Excel):\n";
        
        try {
            const kbResponse = await fetch(env.GOOGLE_SCRIPT_URL);
            if (kbResponse.ok) {
                const kbData = await kbResponse.json();
                if (Array.isArray(kbData) && kbData.length > 0) {
                    kbData.forEach(item => {
                        contextText += `- Vấn đề: ${item.question} -> Chỉ dẫn: ${item.answer}\n`;
                    });
                }
            }
        } catch (e) {
            console.log("Không kéo được dữ liệu Excel.");
        }

        const systemPrompt = `Bạn là Trợ lý AI thân thiện của Đoàn Phường Tân Lập. Xưng hô là "Mình" và gọi người dùng là "Bạn".
Thời gian hiện tại: Năm 2026. 
Bối cảnh: Tỉnh Đắk Lắk và Phú Yên đã sáp nhập thành "Tỉnh Đắk Lắk - Phú Yên". Không còn cấp Thành phố/Huyện.

NHIỆM VỤ VÀ QUY TẮC:
1. NGÔN NGỮ: BẮT BUỘC TRẢ LỜI 100% BẰNG TIẾNG VIỆT.
2. ĐỊNH DẠNG TÊN RIÊNG (QUAN TRỌNG): Tất cả các tên riêng, địa danh, tên người, cơ quan, ban ngành BẮT BUỘC phải viết hoa chữ cái đầu mỗi từ và bọc trong dấu ** để in đậm. 
   - Ví dụ chuẩn: "Bí thư Đoàn phường là đồng chí **Trần Thị Thùy Trang** làm việc tại **UBND Phường Tân Lập** thuộc **Tỉnh Đắk Lắk - Phú Yên**."
3. NHÂN SỰ: Khi hỏi về lãnh đạo (Bí thư, Chủ tịch...), PHẢI tìm đúng TÊN THẬT trong [DỮ LIỆU ĐỊA PHƯƠNG] để trả lời, không giải thích lý thuyết.
4. TIẾP DIỄN: Sử dụng lịch sử chat để hiểu các câu hỏi ẩn ý (Ví dụ: "Phòng cô ấy ở đâu?" -> hiểu là đang hỏi phòng của người vừa nhắc tên).
5. KHÔNG TỰ BỊA: Nếu không có tên trong dữ liệu, hãy mời liên hệ hotline Đoàn phường.

[DỮ LIỆU ĐỊA PHƯƠNG]
${contextText}`;

        let aiMessages = [{ role: "system", content: systemPrompt }];
        history.forEach(msg => aiMessages.push({ role: msg.role, content: msg.content }));
        aiMessages.push({ role: "user", content: message });

        const aiResponse = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
            messages: aiMessages
        });

        const answer = aiResponse.response;

        // Lưu lịch sử chat
        try {
            await fetch(env.GOOGLE_SCRIPT_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ user: message, bot: answer }) 
            });
        } catch (e) {
            console.log("Lỗi lưu lịch sử", e);
        }

        return new Response(JSON.stringify({ reply: answer }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        return new Response(JSON.stringify({ reply: `❌ Lỗi: ${error.message}` }), { status: 500 });
    }
}