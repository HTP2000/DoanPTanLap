export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    if (url.searchParams.get("key") !== env.SYNC_SECRET_KEY) {
        return new Response("Từ chối truy cập! Sai mã bí mật.", { status: 401 });
    }

    try {
        let chunks = [];

        // 1. KÉO DỮ LIỆU TỪ GOOGLE SHEET (Thủ tục hành chính)
        if (env.GOOGLE_SCRIPT_URL) {
            const sheetRes = await fetch(env.GOOGLE_SCRIPT_URL);
            if (sheetRes.ok) {
                const sheetData = await sheetRes.json();
                sheetData.forEach((row, index) => {
                    const textContent = `Câu hỏi/Thủ tục: ${row.question}. Hướng dẫn giải quyết: ${row.answer}`;
                    chunks.push({
                        id: `faq-${index}`,
                        text: textContent,
                        metadata: { type: "thutuc", source: "google_sheet", text: textContent } // Đã thêm trường text vào metadata
                    });
                });
            }
        }

        // 2. KÉO DỮ LIỆU TỪ SANITY CMS (Thông tin địa phương & Nhân sự)
        if (env.SANITY_PROJECT_ID) {
            // Cập nhật Query để lấy thêm trường roles (chức danh phụ)
            const sanityQuery = encodeURIComponent(`*[_type in ["coQuanNhaNuoc", "diemVanHoa"]] { 
                _id, _type, title, description, address, 
                departments[]{ name, personName, roles } 
            }`);
            const sanityRes = await fetch(`https://${env.SANITY_PROJECT_ID}.api.sanity.io/v2022-03-07/data/query/production?query=${sanityQuery}`);
            
            if (sanityRes.ok) {
                const sanityData = (await sanityRes.json()).result;
                sanityData.forEach(item => {
                    // Chặn các dữ liệu không hợp lệ/dữ liệu nháp (nếu có "Nguyễn Văn A" thì bỏ qua)
                    if (item.title && item.title.includes("Nguyễn Văn A")) return;

                    let deptInfo = "";
                    if (item.departments) {
                        deptInfo = item.departments.map(d => {
                            // Xử lý text từ Portable Text của Sanity cho chức vụ
                            const rolesText = d.roles ? d.roles.map(r => r.children.map(c => c.text).join("")).join(", ") : "Chưa cập nhật";
                            return `- Bộ phận: ${d.name} | Cán bộ: ${d.personName || "Chưa rõ"} | Chức danh: ${rolesText}`;
                        }).join("\n");
                    }
                    
                    const textContent = `Cơ quan/Địa điểm: ${item.title}. Địa chỉ: ${item.address || "Chưa rõ"}. Mô tả: ${item.description || "Không có"}. \nDanh sách nhân sự cụ thể:\n${deptInfo}`;
                    
                    chunks.push({
                        id: `sanity-${item._id}`,
                        text: textContent,
                        metadata: { type: "diaphuong", source: "sanity", text: textContent } // Đã thêm trường text vào metadata
                    });
                });
            }
        }

        if (chunks.length === 0) return new Response("Không có dữ liệu mới để đồng bộ.", { status: 400 });

        // 3. ĐƯA VÀO VECTORIZE INDEX
        const BATCH_SIZE = 50;
        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            const batch = chunks.slice(i, i + BATCH_SIZE);
            const embedResponse = await env.AI.run('@cf/baai/bge-m3', { text: batch.map(c => c.text) });
            const vectorsToInsert = batch.map((chunk, index) => ({
                id: chunk.id,
                values: embedResponse.data[index],
                metadata: chunk.metadata
            }));
            await env.VECTORIZE_INDEX.upsert(vectorsToInsert);
        }

        return new Response(JSON.stringify({ success: true, count: chunks.length }), { headers: { "Content-Type": "application/json" } });
    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}