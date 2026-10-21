// Compare persisted content independently of JSON key order and server-assigned IDs.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
  return value;
}
export function sameEntryContent(left, right) {
  const content = entry => {
    const song = { ...entry.song }; delete song.id;
    if (!entry.backingAudioId) delete song.backing;
    return canonical({ song, audioId: entry.audioId ?? null, backingAudioId: entry.backingAudioId ?? null });
  };
  return JSON.stringify(content(left)) === JSON.stringify(content(right));
}

export function reconcileProjectSave(songs, entries, sent, saved, selectedId) {
  const nextSongs = [...songs], nextEntries = new Map(entries);
  saved.songs.forEach((returned, index) => {
    const before = sent.songs[index];
    const currentIndex = before ? nextSongs.findIndex(song => song.id === before.song.id) : -1;
    if (currentIndex < 0) return; // The user removed this entry while saving.
    const current = nextSongs[currentIndex], metadata = nextEntries.get(current.id) || {};
    const unchanged = sameEntryContent({ ...metadata, song: current }, before);
    // A different cloud head must not be attached to a locally edited old body.
    if (!unchanged && !sameEntryContent(returned, before)) return;
    const id = returned.song.id;
    nextSongs[currentIndex] = unchanged ? returned.song : { ...current, id };
    nextEntries.delete(current.id);
    nextEntries.set(id, unchanged ? returned : { ...returned, audioId: metadata.audioId ?? null, backingAudioId: metadata.backingAudioId ?? null });
    if (selectedId === current.id) selectedId = id;
  });
  return { songs: nextSongs, entries: nextEntries, selectedId };
}
