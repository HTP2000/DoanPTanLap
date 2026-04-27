export async function onRequestPost(context) {
    const { request, env } = context;
    const body = await request.json();
    const message = body.message;
    const webData = body.webData || ""; 
    const history = body.history || []; // Lấy bộ nhớ ngữ cảnh từ web gửi lên

    try {
        let contextText = "THÔNG TIN ĐỊA ĐIỂM, DI TÍCH VÀ NHÂN SỰ TRÊN WEB:\n" + webData + "\nKIẾN THỨC NỀN & THỦ TỤC HÀNH CHÍNH (Từ Excel):\n";
        
        // Kéo thêm kiến thức thủ tục từ Google Sheet
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

        // Tạo câu lệnh cốt lõi cho AI (Cập nhật bối cảnh sáp nhập 2026)
        const systemPrompt = `Bạn là trợ lý ảo của Đoàn Phường Tân Lập. Thời gian hiện tại là năm 2026.
NHIỆM VỤ: Chỉ dẫn người dân chính xác các cơ quan, thủ tục, thông tin CÁN BỘ/NHÂN SỰ dựa trên [DỮ LIỆU ĐỊA PHƯƠNG].

BỐI CẢNH HÀNH CHÍNH MỚI (ÉP BUỘC TUÂN THỦ 100%):
- Từ đầu năm 2026, tỉnh Đắk Lắk và Phú Yên đã sáp nhập thành "Tỉnh Đắk Lắk - Phú Yên". 
- Hệ thống chính quyền đã rút gọn chỉ còn 2 cấp: Cấp Tỉnh và Cấp Phường/Xã. 
- Đã bãi bỏ hoàn toàn cấp Thành phố/Huyện (Tuyệt đối KHÔNG ĐƯỢC nhắc đến "TP. Buôn Ma Thuột").
- Địa chỉ chuẩn hiện tại phải luôn là: "Phường Tân Lập, Tỉnh Đắk Lắk - Phú Yên".

QUY TẮC NGHIÊM NGẶT:
1. LUÔN CHÚ Ý ĐẾN LỊCH SỬ TRÒ CHUYỆN (Ngữ cảnh): Nếu người dùng hỏi trống không ở câu tiếp theo (VD: "Phòng nào?", "Địa chỉ ở đâu?"), hãy tự động hiểu họ đang hỏi tiếp về người hoặc cơ quan vừa được nhắc đến ở câu trả lời ngay trước đó của bạn.
2. Dựa vào [DỮ LIỆU ĐỊA PHƯƠNG] để phân loại:
   - Báo án, an ninh, trộm cắp, hộ khẩu, CCCD: Chỉ dẫn đến CÔNG AN PHƯỜNG.
   - Thủ tục hành chính (Công chứng, khai sinh, kết hôn...): Chỉ dẫn đến UBND PHƯỜNG.
   - Hoạt động thanh niên: Chỉ dẫn đến ĐOÀN PHƯỜNG.
3. Nếu không có dữ liệu để trả lời, hãy mời người dân gọi hotline, KHÔNG ĐƯỢC TỰ BỊA RA.

HƯỚNG DẪN TẠO NÚT CHỈ ĐƯỜNG:
Nếu bạn có nhắc đến địa điểm và trong [DỮ LIỆU] có chứa "Link bản đồ: http...", BẮT BUỘC chèn đoạn HTML sau vào DƯỚI CÙNG câu trả lời của bạn:
<br><br><a href="ĐIỀN_LINK_BẢN_ĐỒ" target="_blank" class="inline-block px-4 py-2 bg-blue-600 text-white font-bold rounded-xl shadow-sm hover:bg-blue-700"><i class="fa-solid fa-map-location-dot mr-2"></i> Chỉ đường ngay</a>

[DỮ LIỆU ĐỊA PHƯƠNG]
${contextText}`;

        // NẠP NGỮ CẢNH VÀO ĐẦU AI
        let aiMessages = [{ role: "system", content: systemPrompt }];
        
        // Đưa các câu chat cũ vào (Trí nhớ của AI)
        history.forEach(msg => {
            aiMessages.push({ role: msg.role, content: msg.content });
        });

        // Đưa câu hỏi mới nhất của người dân vào
        aiMessages.push({ role: "user", content: message });

        // Chạy AI Llama-3 của Cloudflare
        const aiResponse = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
            messages: aiMessages
        });

        const answer = aiResponse.response;

        // Lưu Lịch sử Chat vào Google Sheet (ẩn danh)
        try {
            fetch(env.GOOGLE_SCRIPT_URL, {
                method: "POST",
                body: JSON.stringify({ user: message, bot: answer }) 
            });
        } catch (e) {}

        // Trả kết quả về cho Website
        return new Response(JSON.stringify({ reply: answer }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        return new Response(JSON.stringify({ reply: `❌ Lỗi hệ thống: ${error.message}` }), { status: 500 });
    }
}