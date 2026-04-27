export async function onRequestPost(context) {
    const { request, env } = context;
    const body = await request.json();
    const message = body.message;
    const webData = body.webData || ""; 
    const history = body.history || []; 

    try {
        let contextText = "THÔNG TIN ĐỊA ĐIỂM, DI TÍCH VÀ NHÂN SỰ TRÊN WEB:\n" + webData + "\nKIẾN THỨC NỀN & THỦ TỤC HÀNH CHÍNH (Từ Excel):\n";
        
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
            console.log("Không kéo được tài liệu nội bộ từ Google Sheet.");
        }

        // TẠO CÂU LỆNH CỐT LÕI ÉP AI NÓI TIẾNG VIỆT VÀ TÌM ĐÚNG TÊN NHÂN SỰ
        const systemPrompt = `Bạn là trợ lý ảo của Đoàn Phường Tân Lập. Thời gian hiện tại là năm 2026.
NHIỆM VỤ: Chỉ dẫn người dân chính xác các cơ quan, thủ tục, thông tin CÁN BỘ/NHÂN SỰ dựa trên [DỮ LIỆU ĐỊA PHƯƠNG].

BỐI CẢNH HÀNH CHÍNH MỚI (ÉP BUỘC TUÂN THỦ 100%):
- Từ đầu năm 2026, tỉnh Đắk Lắk và Phú Yên đã sáp nhập thành "Tỉnh Đắk Lắk - Phú Yên". 
- Hệ thống chính quyền đã rút gọn chỉ còn 2 cấp: Cấp Tỉnh và Cấp Phường/Xã. 
- Đã bãi bỏ hoàn toàn cấp Thành phố/Huyện (Tuyệt đối KHÔNG ĐƯỢC nhắc đến "TP. Buôn Ma Thuột").
- Địa chỉ chuẩn hiện tại phải luôn là: "Phường Tân Lập, Tỉnh Đắk Lắk".

QUY TẮC NGHIÊM NGẶT NHẤT ĐỊNH PHẢI THEO:
1. NGÔN NGỮ: BẮT BUỘC TRẢ LỜI 100% BẰNG TIẾNG VIỆT (VIETNAMESE). TUYỆT ĐỐI KHÔNG ĐƯỢC DÙNG TIẾNG ANH TRONG BẤT KỲ TRƯỜNG HỢP NÀO.
2. TÌM KIẾM NHÂN SỰ: Khi người dân hỏi ai là người giữ chức vụ nào đó (ví dụ: Bí thư, Chủ tịch...), BẮT BUỘC phải đọc trong [DỮ LIỆU ĐỊA PHƯƠNG] để lấy chính xác TÊN NGƯỜI ĐÓ trả lời, tuyệt đối không được giải thích chung chung định nghĩa chức vụ.
3. LỊCH SỬ TRÒ CHUYỆN: Tự động hiểu ngữ cảnh nếu người dùng hỏi trống không ở câu tiếp theo (VD: "Phòng nào?", "Địa chỉ ở đâu?").
4. Dựa vào [DỮ LIỆU ĐỊA PHƯƠNG] để phân loại cơ quan (Công an, UBND, Đoàn Phường). KHÔNG TỰ BỊA DỮ LIỆU.

HƯỚNG DẪN TẠO NÚT CHỈ ĐƯỜNG:
Nếu bạn có nhắc đến địa điểm và trong [DỮ LIỆU] có chứa "Link bản đồ: http...", BẮT BUỘC chèn đoạn HTML sau vào DƯỚI CÙNG câu trả lời của bạn:
<br><br><a href="ĐIỀN_LINK_BẢN_ĐỒ" target="_blank" class="inline-block px-4 py-2 bg-blue-600 text-white font-bold rounded-xl shadow-sm hover:bg-blue-700"><i class="fa-solid fa-map-location-dot mr-2"></i> Chỉ đường ngay</a>

[DỮ LIỆU ĐỊA PHƯƠNG]
${contextText}`;

        let aiMessages = [{ role: "system", content: systemPrompt }];
        
        history.forEach(msg => {
            aiMessages.push({ role: msg.role, content: msg.content });
        });

        aiMessages.push({ role: "user", content: message });

        const aiResponse = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
            messages: aiMessages
        });

        const answer = aiResponse.response;

        try {
            fetch(env.GOOGLE_SCRIPT_URL, {
                method: "POST",
                body: JSON.stringify({ user: message, bot: answer }) 
            });
        } catch (e) {}

        return new Response(JSON.stringify({ reply: answer }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        return new Response(JSON.stringify({ reply: `❌ Lỗi hệ thống: ${error.message}` }), { status: 500 });
    }
}