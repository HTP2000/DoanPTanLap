export async function onRequestPost(context) {
    const { request, env } = context;
    const { message } = await request.json();

    try {
        // ==========================================
        // TÍNH NĂNG ĐẶC BIỆT: XOAY VÒNG API KEY
        // ==========================================
        // Gom các Key bạn đã cài trên Cloudflare vào 1 danh sách
        const keys = [env.GEMINI_API_KEY_1, env.GEMINI_API_KEY_2, env.GEMINI_API_KEY_3].filter(Boolean);
        
        // Nếu không tìm thấy key nào
        if (keys.length === 0) {
            return new Response(JSON.stringify({ reply: "⚠️ Hệ thống chưa được cấp chìa khóa API." }), { headers: { "Content-Type": "application/json" } });
        }
        
        // Chọn ngẫu nhiên 1 key trong danh sách
        const randomKey = keys[Math.floor(Math.random() * keys.length)];

        // ==========================================
        // 1. KÉO KIẾN THỨC NỀN TỪ GOOGLE SHEET
        // ==========================================
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

        // ==========================================
        // 2. GỌI SANG GOOGLE GEMINI BẰNG KEY NGẪU NHIÊN
        // ==========================================
        const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${randomKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                system_instruction: {
                    parts: [{ text: `Bạn là trợ lý ảo của Đoàn Phường Tân Lập. Hãy ưu tiên dựa vào thông tin sau để trả lời:\n${contextText}\nNếu câu hỏi không nằm trong thông tin trên, hãy trả lời ngắn gọn, lịch sự, thân thiện.` }]
                },
                contents: [{ parts: [{ text: message }] }]
            })
        });
        
        const geminiData = await geminiRes.json();
        
        if (geminiData.error) {
            return new Response(JSON.stringify({ reply: `⚠️ Lỗi từ Gemini: ${geminiData.error.message}` }), { headers: { "Content-Type": "application/json" } });
        }

        const answer = geminiData.candidates[0].content.parts[0].text;

        // ==========================================
        // 3. LƯU LỊCH SỬ VÀO EXCEL
        // ==========================================
        try {
            await fetch(env.GOOGLE_SCRIPT_URL, {
                method: "POST",
                body: JSON.stringify({ user: message, bot: answer }) 
            });
        } catch (e) {
            console.log("Cảnh báo: Không lưu được lịch sử.");
        }

        // ==========================================
        // 4. TRẢ KẾT QUẢ VỀ WEB
        // ==========================================
        return new Response(JSON.stringify({ reply: answer }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        return new Response(JSON.stringify({ reply: `❌ Hệ thống sập do lỗi Backend: ${error.message}` }), { status: 500 });
    }
}
