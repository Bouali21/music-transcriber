import { defineEveryApp } from "@every-app/sdk";

export default defineEveryApp({
  id: "music-transcriber",
  name: "Music Transcriber",
  description:
    "Turns audio and video recordings into sheet music, tabs and MIDI you can play back, edit, export and share.",
  resources: {
    d1: ["DB"],
    // The original recordings.
    r2: ["files"],
  },
  // A shared score's read-only page, open to anyone with its link, and the
  // built scripts and styles that page loads.
  public: [{ path: "/s/:token", methods: ["GET"] }],
  publicAssets: ["/assets/**", "/icon.svg"],
  providers: [
    {
      id: "openrouter",
      why: "Lets the score editor's assistant turn a plain-language request into note edits.",
      docs: "https://openrouter.ai/keys",
    },
  ],
  features: {
    assistant: {
      name: "Editing assistant",
      why: "Edit a score by describing the change in words.",
      providers: ["openrouter"],
    },
  },
});
