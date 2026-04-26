import { defineField, defineType } from 'sanity'

export default defineType({
  name: 'hoiTruong',
  title: 'Hội Trường TDP & Buôn',
  type: 'document',
  fields: [
    defineField({ name: 'badge', title: 'Tên Hội Trường (VD: Hội trường TDP 1)', type: 'string' }),
    defineField({ name: 'order', title: 'Số thứ tự hiển thị', type: 'number' }),
    defineField({ name: 'address', title: 'Địa chỉ', type: 'string' }),
    defineField({ name: 'mapLink', title: 'Link Google Maps', type: 'url' })
  ],
  orderings: [{ title: 'Theo thứ tự', name: 'customOrder', by: [{ field: 'order', direction: 'asc' }] }]
})