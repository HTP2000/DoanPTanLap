export async function onRequestPost(context) {
    const { request, env } = context;
    const body = await request.json();
    const message = body.message;
    const webData = body.webData || ""; 

    try {
        let contextText = "THÔNG TIN ĐỊA ĐIỂM, DI TÍCH TRÊN WEB:\n" + webData + "\nKIẾN THỨC NỀN & THỦ TỤC HÀNH CHÍNH (Từ Excel):\n";
        try {
            // Lấy dữ liệu từ Google Sheet (KienThucNen và DiaDiem_ThuTuc)
            const kbResponse = await fetch(env.GOOGLE_SCRIPT_URL);
            if (kbResponse.ok) {
                const kbData = await kbResponse.json();
                if (Array.isArray(kbData) && kbData.length > 0) {
                    kbData.forEach(item => {
                        contextText += `- Vấn đề/Câu hỏi: ${item.question} -> Chỉ dẫn: ${item.answer}\n`;
                    });
                }
            }
        } catch (e) {
            console.log("Cảnh báo: Không kéo được tài liệu nội bộ từ Google Sheet.");
        }

        // Gọi AI Llama-3 của Cloudflare
        const aiResponse = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
            messages: [
                { 
                    role: "system", 
                    content: `Bạn là trợ lý ảo của Đoàn Phường Tân Lập, TP. Buôn Ma Thuột, Đắk Lắk.
NHIỆM VỤ: Chỉ dẫn người dân chính xác các cơ quan chức năng, khu di tích, tổ dân phố và thủ tục hành chính dựa trên [DỮ LIỆU ĐỊA PHƯƠNG].

QUY TẮC NGHIÊM NGẶT:
1. Không bao giờ nhắc đến TP.HCM hay bất kỳ địa phương nào ngoài Buôn Ma Thuột.
2. Dựa vào [DỮ LIỆU ĐỊA PHƯƠƠNG] để phân loại cơ quan:
   - Báo án, an ninh, trộm cắp, mất giấy tờ, hộ khẩu, CCCD: CHỈ DẪN NGƯỜI DÂN ĐẾN CÔNG AN PHƯỜNG. Tuyệt đối không chỉ sang Đoàn Phường.
   - Thủ tục hành chính (Công chứng, khai sinh, kết hôn, đất đai): CHỈ DẪN ĐẾN UBND PHƯỜNG.
   - Hoạt động thanh niên, sinh hoạt hè: CHỈ DẪN ĐẾN ĐOÀN PHƯỜNG.
3. Không tự bịa thông tin. Nếu không có dữ liệu, hãy mời người dân gọi hotline.

HƯỚNG DẪN TẠO NÚT CHỈ ĐƯỜNG MÀU XANH:
Khi câu trả lời của bạn có hướng dẫn đến một địa điểm và trong [DỮ LIỆU ĐỊA PHƯƠNG] có chứa đoạn "Link bản đồ: http...", bạn BẮT BUỘC phải tạo ra một NÚT BẤM chỉ đường bằng cách chèn ĐÚNG đoạn mã HTML sau vào DƯỚI CÙNG câu trả lời của bạn (thay ĐIỀN_LINK_BẢN_ĐỒ_Ở_ĐÂY bằng đường link thật):
<br><br><a href="ĐIỀN_LINK_BẢN_ĐỒ_Ở_ĐÂY" target="_blank" class="inline-block px-4 py-2 bg-blue-600 text-white font-bold rounded-xl shadow-sm hover:bg-blue-700"><i class="fa-solid fa-map-location-dot mr-2"></i> Chỉ đường ngay</a>

[DỮ LIỆU ĐỊA PHƯƠNG]
${contextText}` 
                },
                { role: "user", content: message }
            ]
        });

        const answer = aiResponse.response;

        // Lưu Lịch sử Chat vào Google Sheet
        try {
            await fetch(env.GOOGLE_SCRIPT_URL, {
                method: "POST",
                body: JSON.stringify({ user: message, bot: answer }) 
            });
        } catch (e) {
            console.log("Cảnh báo: Không lưu được lịch sử chat.");
        }

        // Trả kết quả về cho giao diện web
        return new Response(JSON.stringify({ reply: answer }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        return new Response(JSON.stringify({ reply: `❌ Lỗi hệ thống: ${error.message}` }), { status: 500 });
    }
}