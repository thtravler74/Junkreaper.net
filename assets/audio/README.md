# Background music

Drop a looping track here as **`elevator-music.mp3`** and the player in the top-right
corner picks it up automatically:

```
assets/audio/elevator-music.mp3
```

`assets/` is Vite's `publicDir`, so the file is served at `audio/elevator-music.mp3`
under both the dev server and the packaged `app://` origin. No rebuild is needed in
dev - reload the window.

To point at a different file or a different name, set `VITE_MUSIC_URL` before
starting the app:

```bash
VITE_MUSIC_URL=./audio/my-track.m4a npm run dev
```

Audio files are gitignored (see `.gitignore`) because they are user-supplied assets,
not source. Until you add one, the transport shows `drop an mp3 at
assets/audio/elevator-music.mp3` and the controls stay disabled - the app is fully
functional without it, and the arrival chime is synthesised in the Web Audio API
rather than loaded from a file.

**Autoplay:** Chromium refuses to start audio before the origin has seen a user
gesture. The player attempts playback on load, detects the `NotAllowedError`, and
retries behind the first click or keypress - so the music starts the moment you
interact with the window.
