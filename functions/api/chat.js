export async function onRequestPost(context) {
    const { request, env } = context;
    const body = await request.json();
    const message = body.message;
    const webData = body.webData || ""; 
    const history = body.history || []; 

    try {
        let contextText = "THÔNG TIN CHI TIẾT NHÂN SỰ VÀ ĐỊA ĐIỂM TRÊN WEB:\n" + webData + "\nKIẾN THỨC THỦ TỤC (Từ Sheet DiaDiem_ThuTuc và KienThucNen):\n";
        
        try {
            // Hệ thống kéo dữ liệu từ Google Apps Script (Gồm cả 2 sheet của bạn)
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
            console.log("Không kéo được dữ liệu Excel.");
        }

        // BỘ LỆNH KỶ LUẬT THÉP: CHỈ DÙNG DỮ LIỆU ĐƯỢC CẤP
        const systemPrompt = `Bạn là Trợ lý AI chuyên nghiệp của Đoàn Phường Tân Lập.
Thời gian hiện tại: Năm 2026. 
Bối cảnh: Tỉnh Đắk Lắk và Phú Yên đã sáp nhập thành "Tỉnh Đắk Lắk - Phú Yên". Không còn cấp Thành phố/Huyện.

QUY TẮC CỐT LÕI (PHẢI TUÂN THỦ NGHIÊM NGẶT 100%):
1. RÀ SOÁT DỮ LIỆU TRƯỚC KHI TRẢ LỜI (QUAN TRỌNG NHẤT): Bạn BẮT BUỘC phải đọc và CHỈ SỬ DỤNG thông tin được cung cấp trong phần [DỮ LIỆU ĐỊA PHƯƠNG] bên dưới để trả lời.
2. TUYỆT ĐỐI KHÔNG BỊA ĐẶT: Nếu câu hỏi của người dùng KHÔNG CÓ thông tin trong [DỮ LIỆU ĐỊA PHƯƠNG], bạn KHÔNG ĐƯỢC lấy kiến thức bên ngoài mạng internet để trả lời. Trong trường hợp này, hãy trả lời nguyên văn câu sau: "Dạ, hiện tại hệ thống chưa có thông tin về vấn đề này. Bạn vui lòng liên hệ trực tiếp hotline của Đoàn Phường Tân Lập để được hỗ trợ nhé!".
3. CHÍNH XÁC THẨM QUYỀN: 
   - Báo án, an ninh, hình sự: Chỉ dẫn người dân đến CÔNG AN PHƯỜNG.
   - Thủ tục hành chính, giấy tờ: Chỉ dẫn đến UBND PHƯỜNG.
4. ĐỊNH DẠNG TÊN RIÊNG: Các Tên riêng, Tên người, Địa danh, Cơ quan BẮT BUỘC phải viết hoa chữ cái đầu và bọc trong dấu ** để in đậm (VD: **Trần Thị Thùy Trang**, **UBND Phường Tân Lập**).
5. NGÔN NGỮ VÀ VĂN PHONG: Trả lời 100% bằng tiếng Việt. Xưng hô tự nhiên, lịch sự. Tuyệt đối KHÔNG ĐƯỢC thêm chữ "Mình!" hay các từ cụt lủn ở đầu câu.
6. TIẾP DIỄN NGỮ CẢNH: Dựa vào lịch sử trò chuyện để hiểu các câu hỏi ngắn (Ví dụ: "Cô ấy làm ở phòng nào?").
7. NÚT CHỈ ĐƯỜNG: Nếu có link bản đồ trong dữ liệu, hãy chèn chính xác đoạn HTML này vào cuối câu trả lời:
<br><br><a href="ĐIỀN_LINK_BẢN_ĐỒ" target="_blank" class="inline-block px-4 py-2 bg-blue-600 text-white font-bold rounded-xl shadow-sm hover:bg-blue-700"><i class="fa-solid fa-map-location-dot mr-2"></i> Chỉ đường ngay</a>

[DỮ LIỆU ĐỊA PHƯƠNG]
${contextText}`;

        let aiMessages = [{ role: "system", content: systemPrompt }];
        history.forEach(msg => aiMessages.push({ role: msg.role, content: msg.content }));
        aiMessages.push({ role: "user", content: message });

        const aiResponse = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
            messages: aiMessages
        });

        const answer = aiResponse.response;

        // Lưu lịch sử chat
        try {
            await fetch(env.GOOGLE_SCRIPT_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ user: message, bot: answer }) 
            });
        } catch (e) {
            console.log("Lỗi lưu lịch sử", e);
        }

        return new Response(JSON.stringify({ reply: answer }), {
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        return new Response(JSON.stringify({ reply: `❌ Lỗi: ${error.message}` }), { status: 500 });
    }
}