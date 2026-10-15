# Timed lyrics revision 11: preparation refinements

Feature ID: TL (extension)
Status: Implemented and deployed — UI verification pending
Revision: 11, 2026-10-15
Baseline: [preparation redesign](revision-6.md), [plain lyrics and uniform scrolling](revision-8.md)

## Purpose and scope

Refine the preparation interface for long set names and song library actions, and
let organizers choose when uniform scrolling starts for songs that ignore cue
times. This revision does not change live display controls, library deletion
behavior outside the preparation song actions, or project save boundaries.

## Requirements

- **TL-R62 — Long set names:** In preparation, show the complete set name as a
  continuous marquee when it does not fit in its available field. Do not animate
  names that fit. Keep the name editable and preserve its existing save behavior.
- **TL-R63 — Configurable uniform-scroll start:** In `Строки таймлайна`, provide
  a per-song field labeled `начинать автоскролл через, сек`, defaulting to 10
  seconds for new and existing songs. Enable editing only while
  `игнорировать таймкоды` is selected. Use the configured non-negative whole
  number in the explanation `Без таймкодов текст прокручивается равномерно: с
  %N%-й секунды до конца песни.` In display mode, keep the text at its initial
  position until that timeline time, then scroll uniformly through the declared
  song end. If the configured start is at or after the song duration, keep the
  text at its initial position until the existing end state. Retain the setting
  with the song through existing project, library, local, portable and offline
  persistence paths. Older songs without the field use 10 seconds. Preserve the
  existing timed-song behavior and other pause, seek, reset and audio behavior.
- **TL-R64 — Library actions in preparation:** Remove `Удалить из библиотеки`
  from the song preparation actions; library deletion will be offered separately
  in the library menu. Rename `Обновить версию` to `Обновить из библиотеки`.
  Present this exact explanation as a tooltip for the button and its accessible
  description: `Применит последнюю версию песни из библиотеки только в этом
  проекте: заменит текст, таймкоды и ссылки на аудио. Остальные проекты
  сохранят свои версии. После обновления нажмите «Сохранить».` Preserve the
  existing confirmation, project-only adoption and explicit Save behavior.
- **TL-R65 — Global action icons:** Replace text labels with icon-only buttons
  for the global `Проекты`, `Сохранить`, `Войти`, `Выйти`, `Импорт` and
  `Экспорт` actions wherever they are shown in the application. Use a library
  icon for Projects, a floppy disk for Save, enter/exit arrows with a box for
  Sign in/Sign out, and down/up arrows ending at a horizontal baseline for
  Import/Export respectively. Keep each action's accessible name, and show its
  Russian action label as a tooltip on pointer hover and keyboard focus.
  Preserve visibility, disabled states and existing action behavior. This
  requirement applies to these global actions; other task-specific buttons keep
  their current labeled presentation.
- **TL-R66 — Tooltips for icon buttons:** Every icon-only button in the
  application, including existing and future icon buttons, has a tooltip that
  appears on pointer hover and keyboard focus. Tooltip wording must describe the
  action and must not replace the button's accessible name.

## Acceptance criteria

- **TL-AC50 (R62):** At desktop and narrow widths, short names remain still and
  long names move continuously until their full text can be read. Editing,
  keyboard access and saving continue to work.
- **TL-AC51 (R63):** The field defaults to 10 for new songs and legacy songs,
  is disabled in timed mode and enabled in ignore-timecodes mode. Its value is
  reflected in the exact explanatory sentence. Verify uniform scrolling starts
  at the configured time, including zero, and remains stationary when the start
  is at or beyond the duration. Verify value retention through project Save and
  reopen, library reuse/update, portable export/import and offline preparation.
  Existing songs without the field retain the 10-second behavior; timed mode,
  pause, resume, seek, reset, short-song and backing-audio behavior remain
  unchanged.
- **TL-AC52 (R64):** The preparation actions contain `Обновить из библиотеки`
  with the exact tooltip and accessible description, and no library deletion
  action. Confirm update still replaces the selected project's song with the
  latest library content, leaves other projects pinned, requires explicit Save,
  and retains the existing confirmation. Keep the separate project removal
  action available.
- **TL-AC53 (R65–R66):** At wide and narrow widths, verify each global action
  is represented by the specified icon wherever it appears, with an accessible
  action name and a visible tooltip on hover and keyboard focus. Verify every
  other icon-only button also has both. Verify hidden and disabled states,
  keyboard activation, and that project, save, sign-in/out and import/export
  actions retain their existing behavior. Confirm unrelated task-specific
  buttons retain their labels.

## Evidence and approval

Requested by the user on 2026-10-15. Existing behavior is implemented in
`lyrics-site/public/app.js` (`renderCues`, `positionUniformAudience`,
`renderSongActions`, `adoptLatest`) and `lyrics-site/public/core.js`
(`uniformScrollProgress`, song normalization). Existing persistence flows cover
local sets, shared projects, library revisions, portable archives and offline
project snapshots. The current uniform-scroll introduction is fixed at 10
seconds. The preparation version explanation is currently rendered as visible
paragraph text, and the song actions include library deletion. Global project
actions currently use visible text labels; the live display already has a
tooltip pattern and a library icon definition that can inform a consistent
implementation.

The user approved the reviewed scope with `го` on 2026-10-15. Reviewed draft
SHA-256: `2f7424433b2bf9d0eb3c16fe22cb4230b5c91ad80bc6b63c21ec6d8634c60aeb`.
