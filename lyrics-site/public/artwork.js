import { artworkDimensions } from './artwork-dimensions.js';

/** Presentation uses a project's song override before project and primary art. */
export function presentationArtwork(song, projectId, projectCover = '') {
  if (!projectId) return song.cover || '';
  return song.projectCovers?.find(item => item.projectId === projectId)?.cover || projectCover || song.cover || '';
}

/** Keep accepted source images small enough for JSON storage and screen display. */
export const artworkLimits = Object.freeze({ source: 8 * 1024 * 1024, stored: 192 * 1024, dimension: 1600, pixels: 40_000_000, sourceDimension: 16_000 });
const supported = new Set(['image/jpeg', 'image/png', 'image/webp']);
const dataUrl = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('Не удалось прочитать обложку.'));
  reader.readAsDataURL(blob);
});

export async function prepareArtwork(file) {
  if (!supported.has(file.type) || file.size > artworkLimits.source) throw new Error('Выберите JPG, PNG или WebP до 8 МиБ.');
  const dimensions = artworkDimensions(new Uint8Array(await file.arrayBuffer()));
  if (!dimensions.width || !dimensions.height || Math.max(dimensions.width, dimensions.height) > artworkLimits.sourceDimension || dimensions.width * dimensions.height > artworkLimits.pixels) {
    throw new Error('Обложка слишком большая по разрешению: максимум 40 мегапикселей и 16000 пикселей по стороне.');
  }
  let image;
  try { image = await createImageBitmap(file); }
  catch { throw new Error('Не удалось открыть изображение обложки.'); }
  try {
    if (file.size <= artworkLimits.stored && Math.max(image.width, image.height) <= artworkLimits.dimension) return await dataUrl(file);
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, artworkLimits.dimension / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    for (let attempt = 0; attempt < 12; attempt += 1) {
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.85));
      if (!blob) throw new Error('Не удалось подготовить обложку.');
      if (blob.size <= artworkLimits.stored) return await dataUrl(blob);
      canvas.width = Math.max(1, Math.floor(canvas.width * 0.75));
      canvas.height = Math.max(1, Math.floor(canvas.height * 0.75));
    }
    throw new Error('Не удалось уменьшить обложку. Выберите другое изображение.');
  } finally { image.close(); }
}
