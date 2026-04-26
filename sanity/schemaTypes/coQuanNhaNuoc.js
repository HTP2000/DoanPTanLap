import { defineField, defineType } from 'sanity'

export default defineType({
  name: 'coQuanNhaNuoc',
  title: 'Cơ Quan Nhà Nước',
  type: 'document',
  fields: [
    defineField({ name: 'title', title: 'Tên Cơ Quan', type: 'string' }),
    defineField({ name: 'order', title: 'Số thứ tự hiển thị', type: 'number' }),
    defineField({
      name: 'theme',
      title: 'Màu chủ đạo',
      type: 'string',
      options: { list: [ { title: 'Xanh dương', value: 'blue' }, { title: 'Đỏ', value: 'red' }, { title: 'Xanh lá', value: 'green' }, { title: 'Vàng', value: 'yellow' } ] }
    }),
    defineField({ name: 'unitLabel', title: 'Tùy chỉnh chữ: Người phụ trách / Đồng chí', type: 'string', initialValue: 'Đồng chí' }),
    defineField({ name: 'roomLabel', title: 'Tùy chỉnh chữ: Tầng / Phòng', type: 'string', initialValue: 'Tầng / Phòng' }),
    defineField({ name: 'description', title: 'Mô tả ngắn', type: 'text' }),
    defineField({ name: 'address', title: 'Địa chỉ', type: 'string' }),
    defineField({ name: 'image', title: 'Hình ảnh đại diện', type: 'image', options: { hotspot: true } }),
    defineField({ name: 'mapLink', title: 'Link Google Maps', type: 'url' }),
    defineField({
      name: 'departments',
      title: 'Danh sách Phòng Ban & Cán Bộ',
      type: 'array',
      of: [
        {
          type: 'object',
          fieldsets: [
            { 
              name: 'styleSettings', 
              title: '🎨 Tùy chỉnh hiển thị Tên Cán Bộ', 
              options: { collapsible: true, collapsed: true } 
            },
            { 
              name: 'roleStyleSettings', 
              title: '🎨 Tùy chỉnh hiển thị Chức Danh', 
              options: { collapsible: true, collapsed: true } 
            }
          ],
          fields: [
            { name: 'name', title: 'Tên phòng ban', type: 'string' },
            { name: 'personName', title: 'Tên Cán Bộ', type: 'string' },
            
            // TÙY CHỈNH STYLE CHO TÊN (Đã có)
            { name: 'nameColor', title: 'Màu chữ Tên', type: 'string', fieldset: 'styleSettings', options: { list: [ {title: 'Xanh dương', value: 'text-brand-blue'}, {title: 'Đỏ', value: 'text-red-600'}, {title: 'Đen', value: 'text-slate-800'} ] } },
            { name: 'nameWeight', title: 'Độ đậm Tên', type: 'string', fieldset: 'styleSettings', options: { list: [ {title: 'Đậm', value: 'font-bold'}, {title: 'Thường', value: 'font-normal'} ] } },

            // TÙY CHỈNH STYLE CHO CHỨC DANH (Mới thêm)
            { 
              name: 'roleColor', 
              title: 'Màu chữ Chức danh', 
              type: 'string', 
              fieldset: 'roleStyleSettings',
              options: { list: [ {title: 'Xám (Mặc định)', value: 'text-slate-500'}, {title: 'Đen', value: 'text-slate-800'}, {title: 'Xanh dương', value: 'text-brand-blue'}, {title: 'Đỏ', value: 'text-red-600'} ] }
            },
            { 
              name: 'roleWeight', 
              title: 'Độ đậm Chức danh', 
              type: 'string', 
              fieldset: 'roleStyleSettings',
              options: { list: [ {title: 'Thường (Mặc định)', value: 'font-normal'}, {title: 'In đậm', value: 'font-bold'} ] }
            },
            { 
              name: 'roleStyle', 
              title: 'Kiểu chữ Chức danh', 
              type: 'string', 
              fieldset: 'roleStyleSettings',
              options: { list: [ {title: 'Thẳng', value: 'not-italic'}, {title: 'In nghiêng (Mặc định)', value: 'italic'} ] }
            },
            { 
              name: 'roleSize', 
              title: 'Kích thước Chức danh', 
              type: 'string', 
              fieldset: 'roleStyleSettings',
              options: { list: [ {title: 'Rất nhỏ', value: 'text-[11px]'}, {title: 'Nhỏ (Mặc định)', value: 'text-xs'}, {title: 'Vừa', value: 'text-sm'} ] }
            },

            { name: 'roles', title: 'Các Chức Danh', type: 'array', of: [{ type: 'block' }] },
            { name: 'address', title: 'Số Tầng / Phòng', type: 'string' }
          ],
          preview: { select: { title: 'name', subtitle: 'personName' } }
        }
      ]
    })
  ],
  orderings: [ { title: 'Theo thứ tự tự chọn', name: 'customOrder', by: [{ field: 'order', direction: 'asc' }] } ]
})