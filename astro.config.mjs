import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sanity from "@sanity/astro";

export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [
    sanity({
      projectId: "lnsg0qnd",
      dataset: "production",
      useCdn: true, // Giúp tải dữ liệu cực nhanh
      studioUrl: "/sanity", // Đường dẫn đến trang admin của bạn
    }),
  ],
});