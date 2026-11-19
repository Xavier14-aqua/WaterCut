# Synthetic media fixture

`test-pattern.webm.base64` is a five-second, silent, 160×90, 15 fps VP9 test pattern generated for WaterCut UI tests. It contains no user media. The base64 text is decoded into a temporary file by the smoke test; application users do not need FFmpeg.

Reproduce with FFmpeg:

```powershell
ffmpeg -f lavfi -i testsrc2=size=160x90:rate=15 -t 5 -c:v libvpx-vp9 -b:v 50k -an fixture.webm
```

`test-pattern-av.mp4.base64` is a five-second 160×90, 30 fps H.264 baseline / AAC pattern, with a quiet generated 440 Hz tone. Stage 4A uses it to validate original-audio routing together with the generated WAV BGM and prepare a common-codec Jianying sample. No private footage or sound is included; the smoke runner mutes output.

```powershell
ffmpeg -f lavfi -i testsrc2=size=160x90:rate=30 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 5 -vf format=yuv420p -af volume=0.03 -c:v libx264 -profile:v baseline -level 3.0 -crf 32 -preset slow -c:a aac -b:a 32k -ac 1 -movflags +faststart fixture.mp4
```

Fixtures are decoded only by tests into temporary data directories. FFmpeg is a developer tool, not a packaged runtime dependency.
