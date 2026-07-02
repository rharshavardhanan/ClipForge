# Music library

Drop royalty-free audio here (`.mp3`, `.m4a`, `.wav`, `.aac`, `.flac`, `.ogg`). Two ways to tag a track's mood:

1. **Subfolder** (recommended): `music/intense/drums.mp3`
2. **Filename prefix**: `music/funny_kazoo.mp3`

Moods: `intense · funny · motivational · suspense · emotional · chill` (chill doubles as the fallback when a clip's mood has no tracks).

Each exported clip picks a track matching its Gemini/Claude sentiment (funny→funny, intense→intense, serious→motivational, neutral→chill), loops/trims it to the clip length, fades it in/out, and ducks it under speech automatically. No matching track → the clip ships without music. Disable per run with `--no-music` or the Style tab toggle.
