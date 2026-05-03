export async function onRequest(context) {
    const { request, env } = context;

    // BẢO MẬT: Kiểm tra khóa bí mật trên URL
    const url = new URL(request.url);
    if (url.searchParams.get("key") !== env.SYNC_SECRET_KEY) {
        return new Response("Từ chối truy cập! Sai mã bí mật.", { status: 401 });
    }

    try {
        let chunks = [];

        // ==========================================
        // 1. KÉO DỮ LIỆU TỪ GOOGLE SHEET
        // ==========================================
        if (env.GOOGLE_SCRIPT_URL) {
            const sheetRes = await fetch(env.GOOGLE_SCRIPT_URL);
            if (sheetRes.ok) {
                const sheetData = await sheetRes.json();
                sheetData.forEach((row, index) => {
                    chunks.push({
                        id: `faq-${index}`,
                        text: `Câu hỏi/Thủ tục: ${row.question}. Hướng dẫn giải quyết: ${row.answer}`,
                        metadata: { type: "thutuc", source: "google_sheet" }
                    });
                });
            }
        }

        // ==========================================
        // 2. KÉO DỮ LIỆU TỪ SANITY CMS
        // ==========================================
        if (env.SANITY_PROJECT_ID) {
            const sanityQuery = encodeURIComponent(`*[_type in ["coQuanNhaNuoc", "diemVanHoa"]] { _id, _type, title, description, address, departments[]{ name, personName } }`);
            const sanityRes = await fetch(`https://${env.SANITY_PROJECT_ID}.api.sanity.io/v2022-03-07/data/query/production?query=${sanityQuery}`);
            if (sanityRes.ok) {
                const sanityData = (await sanityRes.json()).result;
                sanityData.forEach(item => {
                    let deptInfo = "";
                    if (item.departments) {
                        deptInfo = item.departments.map(d => `- ${d.name}: ${d.personName || "Chưa cập nhật"}`).join("\n");
                    }
                    chunks.push({
                        id: `sanity-${item._id}`,
                        text: `Cơ quan/Địa điểm: ${item.title}. Địa chỉ: ${item.address || "Chưa rõ"}. Giới thiệu chung: ${item.description || "Không có"}. \nDanh sách nhân sự/Phòng ban:\n${deptInfo}`,
                        metadata: { type: "diaphuong", source: "sanity" }
                    });
                });
            }
        }

        if (chunks.length === 0) {
            return new Response(JSON.stringify({ success: false, message: "Không lấy được dữ liệu nào từ Sheet hoặc Sanity. Vui lòng kiểm tra lại cấu hình." }), { status: 400 });
        }

        // ==========================================
        // 3. ĐƯA VÀO NÃO AI (EMBEDDING) & LƯU VECTOR
        // ==========================================
        const BATCH_SIZE = 50; // Giới hạn xử lý mỗi mẻ của Cloudflare
        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            const batch = chunks.slice(i, i + BATCH_SIZE);
            
            // Dịch văn bản sang Vector bằng model tiếng Việt
            const embedResponse = await env.AI.run('@cf/baai/bge-m3', {
                text: batch.map(c => c.text)
            });

            // Gói lại để đẩy lên Database
            const vectorsToInsert = batch.map((chunk, index) => ({
                id: chunk.id,
                values: embedResponse.data[index],
                metadata: chunk.metadata
            }));

            // Upsert: Cập nhật nếu trùng ID, thêm mới nếu chưa có
            await env.VECTORIZE_INDEX.upsert(vectorsToInsert);
        }

        return new Response(JSON.stringify({ 
            success: true, 
            message: `Quá trình hoàn tất! AI đã nạp thành công ${chunks.length} khối dữ liệu mới.`
        }), { headers: { "Content-Type": "application/json" } });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
}