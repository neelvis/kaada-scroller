import { artworkDimensions } from './artwork-dimensions.js';

/** Presentation uses a project's song override before project and primary art. */
export function presentationArtwork(song, projectId, projectCover = '') {
  if (!projectId) return song.cover || '';
  return song.projectCovers?.find(item => item.projectId === projectId)?.cover || projectCover || song.cover || '';
}

/** Admission limits for original artwork files. */
export const artworkLimits = Object.freeze({ source: 8 * 1024 * 1024, pixels: 40_000_000, sourceDimension: 16_000 });
const supported = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function prepareArtwork(file) {
  if (!supported.has(file.type) || file.size > artworkLimits.source) throw new Error('Выберите JPG, PNG или WebP до 8 МиБ.');
  const dimensions = artworkDimensions(new Uint8Array(await file.arrayBuffer()));
  if (!dimensions.width || !dimensions.height || Math.max(dimensions.width, dimensions.height) > artworkLimits.sourceDimension || dimensions.width * dimensions.height > artworkLimits.pixels) {
    throw new Error('Обложка слишком большая по разрешению: максимум 40 мегапикселей и 16000 пикселей по стороне.');
  }
  let image;
  try { image = await createImageBitmap(file); }
  catch { throw new Error('Не удалось открыть изображение обложки.'); }
  image.close();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Не удалось прочитать обложку.'));
    reader.readAsDataURL(file);
  });
}
