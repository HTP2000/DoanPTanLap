export async function onRequestPost(context) {
    const { request, env } = context;
    const { message } = await request.json();

    try {
        // 1. KÉO KIẾN THỨC NỀN TỪ EXCEL (Vẫn giữ nguyên để AI học tài liệu của Phường)
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
            console.log("Không kéo được tài liệu nội bộ.");
        }

        // 2. GỌI TRỰC TIẾP AI CỦA CLOUDFLARE (KHÔNG CẦN API KEY)
        const aiResponse = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
            messages: [
                { 
                    role: "system", 
                    content: `Bạn là trợ lý ảo của Đoàn Phường Tân Lập. Hãy trả lời cực kỳ ngắn gọn, lịch sự, thân thiện bằng TIẾNG VIỆT. Dựa vào thông tin sau để trả lời:\n${contextText}` 
                },
                { role: "user", content: message }
            ]
        });

        const answer = aiResponse.response;

        // 3. LƯU LỊCH SỬ VÀO EXCEL
        try {
            await fetch(env.GOOGLE_SCRIPT_URL, {
                method: "POST",
                body: JSON.stringify({ user: message, bot: answer }) 
            });
        } catch (e) {
            console.log("Không lưu được lịch sử.");
        }

        // 4. TRẢ KẾT QUẢ VỀ WEB
        return new Response(JSON.stringify({ reply: answer }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        return new Response(JSON.stringify({ reply: `❌ Lỗi hệ thống: ${error.message}` }), { status: 500 });
    }
}
