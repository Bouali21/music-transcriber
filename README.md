# Music Transcriber

Turn audio and video recordings into sheet music, guitar and bass tabs and MIDI. Play scores back, fix them by hand or by asking an assistant, download them and share read-only links.

Inspired by https://songscription.ai

Built with [oss.new](https://oss.new) for [EveryApp](https://github.com/every-app/every-app).

## Features

- Upload an audio or video file, or record from the microphone, choose the instrument and get a score with tempo, key and notes.
- Keep a private library of scores you can search, sort, rename and delete.
- Read scores as staff notation or a piano roll and play them at slower or faster speeds, with a metronome and the original recording.
- Edit notes, title, tempo, key and time signature, transpose, undo and redo, then save.
- Show guitar and bass scores as tablature in standard tuning.
- Download MIDI, MusicXML and PDF.
- Share a read-only link anyone can open, and turn it off again.
- Describe a change in plain words and preview the assistant's edits before keeping them.

Left out: accounts and sign-in, which your Gateway handles; plans and billing; reading sheet music from photos or PDFs; importing from video sites; separating one instrument from a full mix and drums; Guitar Pro export and file import; arranging and multi-instrument mixing; enterprise extras; the companion mobile app.

## Setup

```sh
pnpm install
pnpm dev          # run locally behind the local launcher
pnpm test         # unit tests
pnpm run deploy   # deploy to your Gateway
```

The app needs no secrets or settings: scores live in D1 and recordings in R2, both created on deploy. The editing assistant is optional: add an OpenRouter key on your Gateway (`pnpm everyapp provider add openrouter`) to turn it on. Without one it stays hidden.

The end-to-end checks in `checks/` run against a packaged release in the oss.new validation runtime. The assistant was tested against a fake provider there, not a real model.

## Limitations

- Recordings can be up to 15 minutes and 90 MB.
- Notes are detected in the browser, so a long recording takes a while on a slow device. Results are best for one clear instrument. Busy mixes need more editing.
- Tempo is a single value per score, and new scores start in 4/4.
- Tabs use standard tuning only.
