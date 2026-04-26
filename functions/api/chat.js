export async function onRequestPost(context) {
    const { request, env } = context;
    const { message } = await request.json();

    try {
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
            console.log("Lỗi: Không lấy được kiến thức nền.");
        }

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
        
        // NẾU CÓ LỖI TỪ OPENAI, IN THẲNG RA MÀN HÌNH CHAT
        if (openAiData.error) {
            return new Response(JSON.stringify({ reply: `⚠️ Lỗi từ OpenAI: ${openAiData.error.message}` }), {
                headers: { "Content-Type": "application/json" }
            });
        }

        const answer = openAiData.choices[0].message.content;

        try {
            await fetch(env.GOOGLE_SCRIPT_URL, {
                method: "POST",
                body: JSON.stringify({ user: message, bot: answer }) 
            });
        } catch (e) {
            console.log("Lỗi: Không lưu được lịch sử.");
        }

        return new Response(JSON.stringify({ reply: answer }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        return new Response(JSON.stringify({ reply: `❌ Hệ thống sập do lỗi Backend: ${error.message}` }), { status: 500 });
    }
}