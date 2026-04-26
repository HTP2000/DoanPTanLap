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

        // 2. KÉO KIẾN THỨC NỀN
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

        // 3. TRỘN CÂU LỆNH
        const finalPrompt = `Bạn là trợ lý ảo của Đoàn Phường Tân Lập. Hãy ưu tiên dựa vào thông tin sau để trả lời:\n${contextText}\nNếu câu hỏi không nằm trong thông tin trên, hãy trả lời ngắn gọn, lịch sự, thân thiện.\n\n--- CÂU HỎI CỦA NGƯỜI DÂN ---\n${message}`;

        const payload = {
            contents: [{ parts: [{ text: finalPrompt }] }]
        };

        // 4. VÒNG LẶP QUÉT TỰ ĐỘNG MODEL (Chống lỗi đổi tên của Google)
        let geminiRes;
        let geminiData;
        // Danh sách các đời model chuẩn nhất hiện tại của Google
        const modelsToTry = ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-1.0-pro"];
        
        for (const model of modelsToTry) {
            geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${randomKey}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            
            geminiData = await geminiRes.json();
            
            // Nếu KHÔNG bị lỗi "not found", lập tức thoát vòng lặp để dùng kết quả này
            if (!geminiData.error || !geminiData.error.message.includes("is not found")) {
                break; 
            }
            console.log(`Model ${model} không khả dụng, đang thử model tiếp theo...`);
        }

        // Nếu thử hết các tên vẫn lỗi (VD: sai mã API), thì báo ra màn hình
        if (geminiData.error) {
            return new Response(JSON.stringify({ reply: `⚠️ Lỗi từ Gemini: ${geminiData.error.message}` }), { headers: { "Content-Type": "application/json" } });
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

        // 6. TRẢ KẾT QUẢ VỀ WEB
        return new Response(JSON.stringify({ reply: answer }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        return new Response(JSON.stringify({ reply: `❌ Hệ thống sập do lỗi Backend: ${error.message}` }), { status: 500 });
    }
}
