export async function onRequestPost(context) {
    const { request, env } = context;
    const body = await request.json();
    const message = body.message;
    const webData = body.webData || ""; 

    try {
        // 1. KÉO KIẾN THỨC NỀN TỪ EXCEL VÀ GỘP VỚI GIAO DIỆN WEB
        let contextText = "THÔNG TIN CÁC ĐỊA ĐIỂM TRÊN WEB (Ưu tiên lấy Link bản đồ ở đây):\n" + webData + "\nTHÔNG TIN HỎI ĐÁP KHÁC:\n";
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

        // 2. GỌI TRỰC TIẾP AI CỦA CLOUDFLARE (Không xài Gemini/ChatGPT)
        const aiResponse = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
            messages: [
                { 
                    role: "system", 
                    content: `Bạn là trợ lý ảo của Đoàn Phường Tân Lập, Thành phố Buôn Ma Thuột, tỉnh Đắk Lắk.
QUY TẮC TỐI THƯỢNG:
1. Bạn đang ở Buôn Ma Thuột, Đắk Lắk. Tuyệt đối KHÔNG nhắc đến TP.HCM, Hà Nội hay bất kỳ nơi nào khác.
2. Dựa vào [DỮ LIỆU ĐỊA PHƯƠNG] bên dưới để trả lời. Nếu không có thông tin, hãy nói: "Xin lỗi, mình chưa có thông tin này. Bạn vui lòng liên hệ trực tiếp trụ sở Đoàn Phường Tân Lập (TP. Buôn Ma Thuột) nhé!"
3. Không tự bịa thông tin. Trả lời bằng tiếng Việt.

[DỮ LIỆU ĐỊA PHƯƠNG]
${contextText}

HƯỚNG DẪN TẠO NÚT CHỈ ĐƯỜNG:
Nếu câu trả lời của bạn có nhắc đến một địa điểm mà trong [DỮ LIỆU ĐỊA PHƯƠNG] có kèm "Link bản đồ" (bắt đầu bằng http), bạn BẮT BUỘC phải chèn đoạn mã HTML sau vào DƯỚI CÙNG của câu trả lời:
<br><br><a href="ĐIỀN_LINK_BẢN_ĐỒ_VÀO_ĐÂY" target="_blank" class="inline-block px-4 py-2 bg-blue-600 text-white font-bold rounded-xl shadow-sm hover:bg-blue-700"><i class="fa-solid fa-map-location-dot mr-2"></i> Chỉ đường ngay</a>` 
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