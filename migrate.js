import { createClient } from '@sanity/client';
import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

// 1. CẤU HÌNH KẾT NỐI SANITY (Thay thông tin của bạn vào đây)
const client = createClient({
  projectId: 'lnsg0qnd', // Lấy trong file sanity.config.js
  dataset: 'production',
  useCdn: false,
  token: 'skz3pWA6viO3uHvm9TZ6Ci6VyVIsf7BdtYUiJJAYqzmakoV9ahvJ9GvUHeVWPHYNdY4Lsfj4sBNwpGAd9foWzrGPnroy4kuGtY7ZTPAKJJQgdJ3X0Cd1feouKMnMI05G9bmdcpeKqeTxNqPxBN72M9tu2sYuI1xlTRYMHF8U2JtciPanLfv4', 
  apiVersion: '2024-04-26'
});

async function runMigration() {
    console.log("🚀 BẮT ĐẦU CHUYỂN DỮ LIỆU CƠ QUAN NHÀ NƯỚC...");
    const dirPath = path.join(process.cwd(), 'src/content/coquan');
    
    // Đọc tất cả file .md trong thư mục
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.md'));
    let orderCounter = 1;

    for (const file of files) {
        const filePath = path.join(dirPath, file);
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        
        // Bóc tách dữ liệu từ file Markdown
        const { data } = matter(fileContent);
        console.log(`\n⏳ Đang xử lý: ${data.title}...`);

        // Tự động tải hình ảnh lên Sanity Cloud
        let imageAsset = null;
        if (data.image) {
            const imagePath = path.join(process.cwd(), 'public', data.image);
            if (fs.existsSync(imagePath)) {
                console.log(`   -> Đang tải ảnh lên Cloud...`);
                const imageStream = fs.createReadStream(imagePath);
                imageAsset = await client.assets.upload('image', imageStream);
            } else {
                console.warn(`   -> ⚠️ Không tìm thấy ảnh tại: ${imagePath}`);
            }
        }

        // Xử lý thông tin Phòng ban & Cán bộ (Tự động tách Tên và Chức danh)
        const departments = (data.departments || []).map((dept, idx) => {
            let personName = "";
            let rolesBlocks = [];
            
            if (dept.unit) {
                // Xóa các thẻ HTML cũ (nếu có) và tách bằng dấu "-"
                let cleanUnit = dept.unit.replace(/<[^>]*>?/gm, ''); 
                const parts = cleanUnit.split('-').map(p => p.trim());
                
                personName = parts[0] || ""; // Phần đầu tiên là Tên
                
                // Các phần sau biến thành khối văn bản (Block Content) cho Sanity
                const roles = parts.slice(1);
                rolesBlocks = roles.map((role, i) => ({
                    _type: 'block',
                    _key: `role_${idx}_${i}`,
                    style: 'normal',
                    markDefs: [],
                    children: [{ _type: 'span', _key: `span_${idx}_${i}`, text: role, marks: [] }]
                }));
            }

            return {
                _key: `dept_${idx}`, // Bắt buộc phải có _key cho mảng trong Sanity
                name: dept.name || "",
                personName: personName,
                roles: rolesBlocks,
                address: dept.address || ""
            };
        });

        // Đóng gói thành Document chuẩn của Sanity
        const documentTemplate = {
            _type: 'coQuanNhaNuoc',
            title: data.title,
            order: orderCounter++,
            theme: data.theme || 'blue',
            unitLabel: data.unitLabel || "Đồng chí",
            roomLabel: "Tầng / Phòng",
            description: data.description,
            address: data.address,
            mapLink: data.mapLink,
            departments: departments
        };

        // Gắn ảnh vào Document nếu tải lên thành công
        if (imageAsset) {
            documentTemplate.image = {
                _type: 'image',
                asset: { _type: "reference", _ref: imageAsset._id }
            };
        }

        // Gửi lệnh tạo lên máy chủ Sanity
        await client.create(documentTemplate);
        console.log(`   ✅ Đã tạo xong: ${data.title}`);
    }

    console.log("\n🎉 HOÀN TẤT! HÃY MỞ TRANG ADMIN LÊN VÀ TẬN HƯỞNG NHÉ!");
}

runMigration().catch(console.error);