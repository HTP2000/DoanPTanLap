import { defineField, defineType } from 'sanity'

export default defineType({
  name: 'diemVanHoa',
  title: 'Điểm Văn Hóa Lịch Sử',
  type: 'document',
  fields: [
    defineField({ name: 'title', title: 'Tên Địa Điểm', type: 'string' }),
    defineField({ name: 'order', title: 'Số thứ tự hiển thị', type: 'number' }),
    defineField({ name: 'description', title: 'Mô tả', type: 'text' }),
    defineField({ name: 'address', title: 'Địa chỉ', type: 'string' }),
    defineField({ name: 'image', title: 'Ảnh đại diện', type: 'image', options: { hotspot: true } }),
    defineField({ name: 'mapLink', title: 'Link Google Maps', type: 'url' }),
    defineField({
      name: 'gallery',
      title: 'Thư viện hình ảnh',
      type: 'array',
      of: [{
        type: 'object',
        fields: [
          { name: 'image', title: 'Hình ảnh', type: 'image' },
          { name: 'caption', title: 'Chú thích ảnh', type: 'string' }
        ]
      }]
    })
  ],
  orderings: [{ title: 'Theo thứ tự', name: 'customOrder', by: [{ field: 'order', direction: 'asc' }] }]
})