# Timed lyrics revision 24: backing music in display mode

Feature ID: TL (extension)
Status: Implemented — deployment pending
Revision: 24, 2026-10-23
Baseline: [Specification](spec.md), [backing tracks and live display controls](revision-4.md), and [preparation toolbar actions](revision-22.md).

## Purpose and scope

Clarify that backing music may be attached only to help prepare lyric timings,
while allowing each saved song to choose whether its backing audio starts
audible in display mode. This does not remove or replace the track: display
playback remains synchronized, and the existing mute control can still change
audio output during a show.

## Requirements

- **TL-R140 — Music preparation help:** Extend the music-section description to
  `Необязательно. Запускается вместе с текстом; MP3/WAV до 150 МБ и 20 минут;
  Добавленную музыку можно использовать для разметки текста.`
- **TL-R141 — Include backing music in display:** When a backing track is
  attached, show a checkbox labelled `включать музыку в показ`, checked by
  default. Its tooltip is `если вы добавили музыку только для разметки, снимите
  выбор, чтобы музыка не воспроизводилась по умолчанию`. Store this preference
  with the saved song data so it follows that song in projects and offline
  copies. Changing the preference does not invalidate lyric readiness. If the
  preference is absent in older saved data, treat it as enabled to preserve
  existing behavior.
- **TL-R142 — Initial display mute state:** At the start of display playback,
  use the selected song's preference to determine its initial audio state:
  enabled starts audible; disabled starts muted while keeping the backing track
  available and synchronized. The display mute control may still unmute or mute
  audio for the current show. Do not save that temporary display toggle back to
  the song preference. When switching songs in display mode, use the newly
  selected song's saved preference.

## Acceptance criteria

- **TL-AC107 (R140):** Verify the music section displays the exact extended
  description, including the sentence about using music to time lyrics.
- **TL-AC108 (R141):** With attached music, verify the checkbox label and exact
  tooltip, its checked initial state, persistence after save/reopen and offline
  copy refresh, and no loss of readiness when toggled. Verify older songs
  without the preference are treated as enabled.
- **TL-AC109 (R142):** Launch songs with the preference enabled and disabled.
  Enabled starts audible; disabled starts muted while its track remains
  synchronized and can be unmuted manually. Switch between songs with different
  settings and verify each gets its own initial state. Temporary mute changes
  do not change the saved checkbox value.

## Evidence and approval

The user requested this change on 2026-10-23. The current music description is
rendered by `lyrics-site/public/song-editor.js`; song fields are normalized by
`lyrics-site/public/core.js`; display audio is armed in `lyrics-site/public/app.js`
and muted through `lyrics-site/public/playback.js`. Existing backing playback
and mute behavior is specified by TL-R33–R35 in [revision 4](revision-4.md).

The user approved this interpretation on 2026-10-23: the preference sets the
initial mute state rather than removing the audio from display playback; a
manually unmuted track remains synchronized, and switching songs reapplies that
song's own preference. Existing songs without a stored preference default to
enabled. The user also requested a commit and deployment after implementation.

Implementation evidence: `core.js` normalizes and creates the per-song
`includeBackingInShow` preference with a backwards-compatible enabled default.
`song-editor.js` renders the requested description and, when music is attached,
the checkbox with its tooltip. Toggling it updates the song without invalidating
readiness. `app.js` applies the selected song's preference as the initial mute
state while retaining synchronized backing playback.
