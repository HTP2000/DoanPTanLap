export async function onRequestPost(context) {
    const { request, env } = context;
    const { message } = await request.json();

    try {
        // 1. GỌI SANG GOOGLE SHEET ĐỂ LẤY "KIẾN THỨC NỀN" (Dùng hàm doGet của bạn)
        let contextText = "Đây là thông tin chuẩn của Phường Tân Lập:\n";
        try {
            const kbResponse = await fetch(env.GOOGLE_SCRIPT_URL);
            const kbData = await kbResponse.json();
            
            // Ép dữ liệu thành dạng văn bản cho AI đọc
            if (Array.isArray(kbData) && kbData.length > 0) {
                kbData.forEach(item => {
                    contextText += `- Hỏi: ${item.question} -> Đáp: ${item.answer}\n`;
                });
            }
        } catch (e) {
            console.log("Không kéo được kiến thức nền, dùng AI mặc định");
        }

        // 2. GỬI CÂU HỎI VÀ KIẾN THỨC NỀN CHO CHATGPT
        const openAiRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-3.5-turbo",
                messages: [
                    {
                        role: "system", 
                        content: `Bạn là trợ lý ảo của Đoàn Phường Tân Lập. Hãy ưu tiên dựa vào thông tin sau để trả lời:\n${contextText}\nNếu câu hỏi của người dùng không nằm trong thông tin trên, hãy trả lời theo hiểu biết của bạn một cách ngắn gọn, lịch sự, thân thiện.`
                    },
                    { role: "user", content: message }
                ]
            })
        });
        
        const openAiData = await openAiRes.json();
        const answer = openAiData.choices[0].message.content;

        // 3. LƯU LỊCH SỬ VÀO SHEET "LichSuChat" (Dùng hàm doPost của bạn)
        // Lưu ý: Đã đổi tên biến thành "user" và "bot" để khớp hoàn toàn với code Apps Script
        await fetch(env.GOOGLE_SCRIPT_URL, {
            method: "POST",
            body: JSON.stringify({ user: message, bot: answer }) 
        });

        // 4. TRẢ KẾT QUẢ VỀ CHO GIAO DIỆN WEB
        return new Response(JSON.stringify({ reply: answer }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        return new Response(JSON.stringify({ reply: "Xin lỗi, hệ thống đang bận. Vui lòng thử lại sau!" }), { status: 500 });
    }
}