# VITALINK: 3D site + API

```bash
npm install
npm --prefix server install
npm run dev:all       # site http://localhost:5173, API http://localhost:8787
npm run server:test   # backend tests
npm run lint && npm run build
```

Frontend: React + Vite + react-three-fiber (`src/`). Backend: see `server/README.md`.
The 3D canvas renders at the display's native pixel ratio (max 2x) and steps down automatically if the GPU can't keep up.

Smooth scroll: Lenis drives wheel scrolling (touch stays native, reduced-motion users get plain scrolling).
Add `?fps` to the URL (http://localhost:5173/?fps) to show a live FPS meter.
Billing: booking creates an invoice, with pay, refund-on-cancel and PDF download. Details in `server/README.md`.

## New in this update
- **Invoice delivery**: signed expiring share links, "Share on WhatsApp", "Email me this", automatic emailed receipt after online payment, optional `INVOICE_WEBHOOK_URL`. See `server/.env.example`.
- **Doctor dashboard**: `GET /api/doctor/dashboard` and a dashboard section shown to signed-in doctors.
- **Phone layout**: sign-in stays reachable on small screens, larger tap targets, no iOS input zoom.
- New tests: `server/test/delivery.test.ts`. Run `npm --prefix server test`.
- **Pages** (real URLs, History API, no extra dependency): `/` Home, `/book`, `/band`, `/bills` (also `/orders`), `/dashboard`. In production, host the built site with a fallback to `index.html` (a Netlify `_redirects` file is included; other hosts need an equivalent rewrite rule).

## Scroll-scrubbed image sequences (GSAP ScrollTrigger)
`src/sections/ScrubCanvas.tsx` pins a section, scrubs a frame index with GSAP ScrollTrigger and draws it on a canvas.
Eight scenes live in `public/frames/{heart,problem,platform,intent,morph,stack,data,closing}` (~1,950 frames, ~64 MB total, downloaded lazily as you approach each scene): 1920x1080 WebP, extracted from the videos at 24 fps.
The 3D scene stops rendering while a sequence is on screen. To swap footage, re-export frames as `0001.webp ...` and update the
`frames` count in `HeartScrub` / `MorphScrub`:
`ffmpeg -i clip.mp4 -vf "scale=1920:1080" -c:v libwebp -quality 72 public/frames/NAME/%04d.webp`
