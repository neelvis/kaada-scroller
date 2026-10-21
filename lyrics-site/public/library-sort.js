export const LIBRARY_SORTS = [
  { value: 'date-oldest', label: 'по дате (ранние)' },
  { value: 'date-newest', label: 'по дате (поздние)' },
  { value: 'artist-asc', label: 'по исполнителю (А-Я)' },
  { value: 'artist-desc', label: 'по исполнителю (Я-А)' },
  { value: 'title-asc', label: 'по названию (А-Я)' },
  { value: 'title-desc', label: 'по названию (Я-А)' },
];

export const DEFAULT_LIBRARY_SORT = 'date-newest';

function text(value) {
  return String(value ?? '').trim();
}

function compareText(left, right) {
  return text(left).localeCompare(text(right), 'ru', { sensitivity: 'base' });
}

function compareDateNewest(left, right) {
  const a = Date.parse(left.createdAt || '');
  const b = Date.parse(right.createdAt || '');
  if (Number.isNaN(a) || Number.isNaN(b)) {
    if (Number.isNaN(a) !== Number.isNaN(b)) return Number.isNaN(a) ? 1 : -1;
    return 0;
  }
  return b - a;
}

function compareIdentity(left, right) {
  return String(left.id ?? '').localeCompare(String(right.id ?? ''), undefined, { sensitivity: 'base' });
}

export function sortLibrarySongs(songs, sort = DEFAULT_LIBRARY_SORT) {
  const direction = sort.endsWith('-desc') ? -1 : 1;
  return [...songs].sort((left, right) => {
    let compared = 0;
    if (sort === 'date-oldest' || sort === 'date-newest') {
      compared = compareDateNewest(left, right) * (sort === 'date-oldest' ? -1 : 1);
    } else if (sort === 'artist-asc' || sort === 'artist-desc') {
      const leftArtist = text(left.artist);
      const rightArtist = text(right.artist);
      if (!leftArtist || !rightArtist) compared = leftArtist ? -1 : rightArtist ? 1 : 0;
      else compared = compareText(leftArtist, rightArtist) * direction;
      if (!compared) compared = compareText(left.title, right.title);
    } else {
      compared = compareText(left.title, right.title) * direction;
    }
    if (!compared) compared = compareDateNewest(left, right);
    return compared || compareIdentity(left, right);
  });
}
