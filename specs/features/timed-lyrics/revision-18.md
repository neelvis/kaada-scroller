# Timed lyrics revision 18: focused project and song editing

Feature ID: TL (extension)
Status: Implemented and deployed — production smoke-checked; feature behavior
not test-verified
Revision: 18, 2026-10-22
Baseline: [Specification](spec.md), [projects and durable files](revision-14.md),
[cloud library and local project copies](revision-16.md), and [cue ordering](revision-17.md).

## Purpose and scope

Simplify the organizer interface and make project/song editing actions easier to
understand. Keep cloud projects and songs as the shared source of truth, and keep
selected-folder project copies up to date through the existing project save.
This revision removes whole-project portable import/export from the application
and supersedes the affected TL-R6, TL-R14, TL-R76–R77, TL-R81, TL-R87–R88
and TL-R91–R93 behavior.

LRC and plain-lyrics import used while preparing an individual song are separate
preparation tools and remain available. This change does not remove cloud
library/project APIs, project download, playback, or files already in a selected
local folder. It does not add automatic conflict merging.

## Requirements

- **TL-R100 — Local-folder control:** Replace the `Локальная копия` text button
  with an accessible hard-drive icon button. Its tooltip and accessible name
  identify the selected folder by name; with no selected folder, use
  `папка не выбрана`. Preserve the existing folder selection/change behavior.
- **TL-R101 — Account controls:** Show sign-in and sign-out in the top bar as
  box-and-arrow icons pointing inward and outward respectively. Provide matching
  accessible names and tooltips; retain their current actions.
- **TL-R102 — Remove whole-project exchange:** Remove the top-level project
  `Импорт` and `Экспорт` actions and their portable whole-project JSON/ZIP
  workflows. Keep in-song LRC/plain-text and LRCLIB preparation import actions.
  This also removes portable import/export as the fallback for unsupported
  browsers or failed local-folder saves.
  Do not delete user files or existing local project folders as part of removing
  these application actions. Existing portable archives need not remain
  importable through this application after this revision.
- **TL-R103 — Stale cached project removal:** If a cloud project selected for
  deletion is already absent on the server, remove that project's disposable
  browser cache and draft, and remove its project record and cloud link from the
  active data in the selected working folder. Treat server not-found during
  lookup or deletion as successful cleanup. Keep other projects intact. The
  working folder's earlier immutable recovery snapshots may still contain the
  old project; they are not loaded as current data and are retained to preserve
  recovery from interrupted saves. Show ordinary errors for other failures.
- **TL-R104 — Quiet shell status:** Do not show the `Оболочка приложения
  сохранена` success message. The offline application cache may continue working
  without announcing this message.
- **TL-R105 — Project save and local copy:** Remove the project editor's
  `Сохранить локально` action. The top-bar save control has tooltip and
  accessible name `Сохранить проект`; one explicit save persists project edits
  and changed songs to the cloud, and refreshes the project's selected local
  folder copy when one exists. Keep truthful pending/success/failure reporting.
- **TL-R106 — Project song ordering and additions:** In the project editor,
  support moving songs by both adjacent arrow controls and pointer drag-and-drop.
  Keep the order after save and reopen. Place the project song-add actions as
  subordinate actions of `Запустить`, so adding a song is available from that
  launch control without a separate peer action. Keyboard access remains
  available.
- **TL-R107 — Song readiness scope:** Editing title, artist, recording version
  or duration alone does not invalidate a song's readiness confirmation. Changes
  to lyric/timeline rows or the selected/replaced/removed backing track do
  invalidate it. Existing content validation still applies before save or
  playback.
- **TL-R108 — Focused timeline controls:** Remove the `+ Строка`, `Отметить
  следующую` and `Отменить отметку` buttons from the timeline toolbar. Keep
  row removal controls, existing LRC/plain-text ways to replace timeline rows,
  and per-row clock marking. Remove the explanatory notice that later changes
  cancel timeline confirmation. Use the timeline help text
  `Время — начало строки. Отмечайте начало кнопкой с часами у строки.` Add the
  tooltip `выберите если таймкоды недоступны` to `игнорировать таймкоды`.
- **TL-R109 — Clock marking from music:** A row's clock action records the
  current playback time of the song's backing track into that row. Without a
  backing track, disable the action and show tooltip
  `загрузите музыку для разметки строк по мере воспроизведения`.
- **TL-R110 — Music wording and limits:** Rename the `Минусовка` section and
  its replace/remove actions to `Музыка`, `Заменить музыку` and `Удалить
  музыку`. Use the description `Необязательно. Запускается вместе с текстом;
  MP3/WAV до 150 МБ и 20 минут;`.
- **TL-R111 — Library copy creation:** Remove `Сохранить копию` from song
  editing. Add `Создать копию` to library song actions. Activating it creates a
  separate cloud library song with the same content and recording metadata,
  named `<source title> (копия N)`. Choose the lowest positive N whose resulting
  title/artist/version identity is not already used. The original remains
  unchanged; existing cloud readiness and duplicate validation still apply.

## Acceptance criteria

- **TL-AC76 (R100–R104):** Check selected/unselected folder tooltip and accessible
  name; inward/outward account icons and accessible names; absence of whole-set
  import/export actions while in-song text/LRC imports remain; deletion of a
  server-missing project removes its browser cache/draft and active working
  folder entry/link while retaining other projects and recoverable prior
  snapshots; no shell-saved message appears.
- **TL-AC77 (R105–R106):** Save changed project membership/order and edited songs
  with one save action. Verify a selected local folder copy refreshes, failures
  remain visible, and no separate local-save button exists. Reorder songs with
  arrows and drag-and-drop, save/reopen, and access both add-song actions from
  the `Запустить` control with keyboard and pointer.
- **TL-AC78 (R107–R110):** Change each metadata field without losing readiness;
  change timeline rows and backing music and verify readiness is invalidated.
  Verify removed toolbar actions/notices, exact timeline and ignore-timecode
  help, clock capture from playing backing music, disabled no-music clock state
  and tooltip, and music section/action labels and description.
- **TL-AC79 (R111):** Create multiple copies from the library. Each receives the
  next lowest available `(копия N)` title for its artist/version identity,
  preserves the song and audio content, appears as a separate cloud library
  record, and leaves the source unchanged. Existing duplicate/readiness errors
  remain actionable.

## Evidence, proposals and approval

The user requested these interface and behavior changes on 2026-10-22. After
reviewing the first draft, the user approved the remaining scope and requested
that stale-project cleanup also remove the active working-folder copy. The
updated requirement retains immutable prior snapshots as recovery data. The
current implementation evidence is in `lyrics-site/public/index.html`,
`app.js`, `song-editor.js`, `workspace-hub.js`, `offline-projects.js`,
`workspace-actions.js` and `backend/store.py`. Accepted behavior being changed
is anchored in TL-R14, TL-R76–R81 and TL-R84–R93, especially portable
import/export, local-save controls, song-copy placement and readiness
invalidation.

Approved scope interpretation: “Импорт/Экспорт” means the top-level
whole-project portable JSON/ZIP actions; individual-song LRC/plain-text and
LRCLIB preparation imports remain. “Подкнопкой `Запустить`” means the project
song-add actions are presented as subordinate choices attached to that control.
The copy number is the lowest positive unused number for the resulting
title/artist/recording-version identity.

Approval: the user approved the remainder of revision 18 with `остальное ок` and
then explicitly accepted TL-R103's active working-folder deletion while
retaining immutable recovery snapshots with `подходит.` on 2026-10-22. This
approves TL-R100–R111 and TL-AC76–AC79 for implementation.
