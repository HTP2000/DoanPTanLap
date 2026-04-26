export async function onRequestPost(context) {
    const { request, env } = context;
    const { message } = await request.json();

    try {
        // 1. TÍNH NĂNG XOAY VÒNG API KEY
        const keys = [env.GEMINI_API_KEY_1, env.GEMINI_API_KEY_2, env.GEMINI_API_KEY_3].filter(Boolean);
        
        if (keys.length === 0) {
            return new Response(JSON.stringify({ reply: "⚠️ Hệ thống chưa được cấp chìa khóa API." }), { headers: { "Content-Type": "application/json" } });
        }
        const randomKey = keys[Math.floor(Math.random() * keys.length)];

        // 2. KÉO KIẾN THỨC NỀN TỪ EXCEL
        let contextText = "Đây là thông tin chuẩn của Phường Tân Lập:\n";
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
            console.log("Cảnh báo: Không kết nối được Google Sheet.");
        }

        // =========================================================================
        // 3. TUYỆT CHIÊU: HỎI GOOGLE XEM API KEY NÀY ĐƯỢC PHÉP DÙNG MODEL NÀO
        // =========================================================================
        const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${randomKey}`);
        const listData = await listRes.json();

        // Nếu API Key bị hỏng hoặc khóa, báo lỗi ngay lập tức
        if (listData.error) {
            return new Response(JSON.stringify({ reply: `⚠️ Lỗi kiểm tra API Key: ${listData.error.message}` }), { headers: { "Content-Type": "application/json" } });
        }

        // Lọc ra danh sách các model Gemini có chức năng chat
        const validModels = (listData.models || []).filter(m => 
            m.name.includes("gemini") && 
            m.supportedGenerationMethods && 
            m.supportedGenerationMethods.includes("generateContent")
        );

        if (validModels.length === 0) {
            return new Response(JSON.stringify({ reply: "⚠️ API Key của bạn hiện không có quyền sử dụng tính năng Chat AI của Google." }), { headers: { "Content-Type": "application/json" } });
        }

        // Tự động tìm bản 1.5-flash tốt nhất, nếu không có thì lấy model đầu tiên trong danh sách cho phép
        let chosenModel = validModels.find(m => m.name.includes("1.5-flash"));
        if (!chosenModel) chosenModel = validModels[0];

        // =========================================================================
        // 4. GỌI CHATBOT VỚI MODEL VỪA TÌM ĐƯỢC
        // =========================================================================
        const finalPrompt = `Bạn là trợ lý ảo của Đoàn Phường Tân Lập. Hãy ưu tiên dựa vào thông tin sau để trả lời:\n${contextText}\nNếu câu hỏi không nằm trong thông tin trên, hãy trả lời ngắn gọn, lịch sự, thân thiện.\n\n--- CÂU HỎI CỦA NGƯỜI DÂN ---\n${message}`;

        const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/${chosenModel.name}:generateContent?key=${randomKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: finalPrompt }] }]
            })
        });
        
        const geminiData = await geminiRes.json();
        
        if (geminiData.error) {
            return new Response(JSON.stringify({ reply: `⚠️ Lỗi lúc trả lời: ${geminiData.error.message}` }), { headers: { "Content-Type": "application/json" } });
        }

        const answer = geminiData.candidates[0].content.parts[0].text;

        // 5. LƯU LỊCH SỬ VÀO EXCEL
        try {
            await fetch(env.GOOGLE_SCRIPT_URL, {
                method: "POST",
                body: JSON.stringify({ user: message, bot: answer }) 
            });
        } catch (e) {
            console.log("Cảnh báo: Không lưu được lịch sử.");
        }

        // 6. TRẢ KẾT QUẢ VỀ GIAO DIỆN WEB
        return new Response(JSON.stringify({ reply: answer }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        return new Response(JSON.stringify({ reply: `❌ Hệ thống sập do lỗi Backend: ${error.message}` }), { status: 500 });
    }
}
