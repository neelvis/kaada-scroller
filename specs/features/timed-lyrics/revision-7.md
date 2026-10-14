# Timed lyrics revision 7: display pause

Feature ID: TL (extension)
Status: Implemented and locally verified
Revision: 7, 2026-10-14
Baseline: [live display controls](revision-4.md)

## Requirement

- **TL-R49 — Display pause and resume:** In display mode, the Start control
  reads `Пауза` while playback is running. Activating it freezes the lyric
  timeline and pauses any backing track at the current position. The control
  then reads `Старт`; activating it resumes both from that position. This works
  with and without backing audio. During pending playback startup, keep the
  control disabled with `Запуск…`. Existing seek, mute, end, reset, exit and song
  switching behavior remains applicable. Reset returns to zero; pausing does
  not reset the position.

This supersedes the pause/resume exclusion in TL-R11 and extends TL-R35.
Repeated calls to the underlying Start operation still cannot create overlapping
playback; the visible running control now explicitly requests Pause.

## Acceptance criteria

- **TL-AC40 (R49):** Start a song, observe `Пауза`, pause and verify that both
  lyrics/progress and backing audio stop advancing. Observe `Старт`, resume and
  verify continuation from the saved position without restarting at zero.
  Repeat without backing audio and after seeking while paused. Verify reset
  and song end retain their existing behavior.

## Approval

The user explicitly approved this draft on 2026-10-14 with
`Да, подтверждаю` after reviewing the pause/resume behavior and canonical path.

## Verification

TL-AC40 is covered by `lyrics-site/tests/live-display-browser.mjs`: backing
pause/resume, frozen progress, lyrics-only pause/resume, paused seek and reset.
The display browser suite, redesign browser suite, six playback unit tests and
portable build passed locally on 2026-10-14. Layout inspection verified single-line
LRCLIB labels at widths 320–1440 and action-row alignment at 1070/1440 with
responsive wrapping at 375, using a mocked server project for presentation.
Production deployment and event rehearsal were not performed in this change.
