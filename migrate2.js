import { createClient } from '@sanity/client';
import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const client = createClient({
  projectId: 'lnsg0qnd', 
  dataset: 'production',
  useCdn: false,
  token: 'skz3pWA6viO3uHvm9TZ6Ci6VyVIsf7BdtYUiJJAYqzmakoV9ahvJ9GvUHeVWPHYNdY4Lsfj4sBNwpGAd9foWzrGPnroy4kuGtY7ZTPAKJJQgdJ3X0Cd1feouKMnMI05G9bmdcpeKqeTxNqPxBN72M9tu2sYuI1xlTRYMHF8U2JtciPanLfv4', 
  apiVersion: '2024-04-26'
});

async function uploadImage(imagePathStr) {
    if (!imagePathStr) return null;
    const fullPath = path.join(process.cwd(), 'public', imagePathStr);
    if (fs.existsSync(fullPath)) {
        console.log(`   -> Đang tải ảnh: ${imagePathStr}`);
        const imageStream = fs.createReadStream(fullPath);
        return await client.assets.upload('image', imageStream);
    }
    return null;
}

async function migrateVanHoa() {
    console.log("🚀 BẮT ĐẦU CHUYỂN DỮ LIỆU ĐIỂM VĂN HÓA...");
    const dirPath = path.join(process.cwd(), 'src/content/vanhoa');
    if (!fs.existsSync(dirPath)) return;
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.md'));
    let orderCounter = 1;

    for (const file of files) {
        const fileContent = fs.readFileSync(path.join(dirPath, file), 'utf-8');
        const { data } = matter(fileContent);
        console.log(`\n⏳ Đang xử lý: ${data.title}...`);

        const mainImageAsset = await uploadImage(data.image);

        let galleryBlocks = [];
        if (data.gallery && Array.isArray(data.gallery)) {
            for (let i = 0; i < data.gallery.length; i++) {
                const item = data.gallery[i];
                const galAsset = await uploadImage(item.image);
                if (galAsset) {
                    galleryBlocks.push({
                        _key: `gal_${i}`,
                        image: { _type: 'image', asset: { _type: "reference", _ref: galAsset._id } },
                        caption: item.caption || ""
                    });
                }
            }
        }

        await client.create({
            _type: 'diemVanHoa',
            title: data.title,
            order: orderCounter++,
            description: data.description,
            address: data.address,
            mapLink: data.mapLink,
            image: mainImageAsset ? { _type: 'image', asset: { _type: "reference", _ref: mainImageAsset._id } } : undefined,
            gallery: galleryBlocks
        });
        console.log(`   ✅ Xong: ${data.title}`);
    }
}

async function migrateHoiTruong() {
    console.log("\n🚀 BẮT ĐẦU CHUYỂN DỮ LIỆU HỘI TRƯỜNG...");
    const dirPath = path.join(process.cwd(), 'src/content/todanpho');
    if (!fs.existsSync(dirPath)) return;
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.md'));
    let orderCounter = 1;

    for (const file of files) {
        const fileContent = fs.readFileSync(path.join(dirPath, file), 'utf-8');
        const { data } = matter(fileContent);
        console.log(`⏳ Đang xử lý: ${data.badge}...`);

        await client.create({
            _type: 'hoiTruong',
            badge: data.badge,
            order: orderCounter++,
            address: data.address,
            mapLink: data.mapLink
        });
        console.log(`   ✅ Xong: ${data.badge}`);
    }
}

async function run() {
    await migrateVanHoa();
    await migrateHoiTruong();
    console.log("\n🎉 HOÀN TẤT CHUYỂN TOÀN BỘ DỮ LIỆU!");
}

run().catch(console.error);