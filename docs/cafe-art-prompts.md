# Café art refinement — exact built-in imagegen prompts

Generated for the full-screen café refinement on 2026-10-05. Existing scene and poses are retained. Only the served drinks and a cup-free background plate were generated; no full sprite pack.

## Matcha cutout

Asset: `frontend/public/cafe/drink-matcha.png`. Reference: existing `scene.png`. `transparent_background=true`.

Use case: background-extraction / game UI asset. Input image 1 is the existing café scene and exact style reference. Extract/recreate ONLY the ceramic matcha cup and saucer in its foreground, as a single isolated asset on genuine transparency. Preserve its cream speckled glazed ceramic, brown thin rim, sage saucer, handle on right, green matcha surface with delicate creamy leaf latte art, hand-drawn anime/lofi illustration lines, painterly grain and sunny upper-left light. Three-quarter front view slightly looking down, the same perspective as input. Center the whole cup and saucer with narrow clear margins; large object filling roughly 85% canvas width. No counter, no barista, no background, no extra objects, no text, no watermark. A soft contact shadow immediately beneath the saucer is okay but no rectangular backdrop. Intended to sit on the same illustrated café bar as a served drink.

## Coffee cutout

Asset: `frontend/public/cafe/drink-coffee.png`. Reference: `drink-matcha.png`. `transparent_background=true`.

Use case: precise-object-edit / transparent game UI asset. Input image 1 is the matcha cup asset to edit. Change ONLY green matcha liquid to rich warm brown coffee with the same creamy leaf latte art. Keep cup, ceramic speckle, thin brown rim, handle, saucer, geometry, camera angle, framing, illustrated contour lines and warm upper-left lighting exactly unchanged. Background MUST be truly fully transparent, including any diffuse brown backdrop/glow outside the cup and saucer: remove all backdrop glow, leave just cup and saucer. No rectangular background, no counter, no other objects, no text. This coffee asset will be layered directly into its original sunny hand-drawn café scene.

## Clear bar plate

Asset: `frontend/public/cafe/bar-clear.png`. Reference: existing `scene.png`. `transparent_background=false`.

Use case: precise-object-edit. Image 1 is the edit target café scene. Remove ONLY the matcha cup, its handle, saucer and their cast shadow from the foreground wooden counter (the object approximately within pixels x=820..1120 and y=720..920 of the 1536x1024 original). Inpaint the matching uninterrupted sunny wood grain of the counter where that object used to be. Keep the barista, her face and all anatomy/hands, sugar machine, bowl under it, receipt, buildings, plants, espresso machine and ALL other pixels unchanged. Preserve exact framing, camera, canvas aspect ratio 3:2 and hand-drawn lo-fi illustration style. This is a background plate for layering a new drink dynamically into the same scene. No new objects, no text, no layout changes.

## Visual QA

The cutouts have real alpha and were inspected both independently and over the scene. Coffee changes the liquid only; both share ceramic, saucer, framing and lighting. The bar plate removes the old fixed matcha to avoid a duplicate drink. Canvas animation keeps the local eye/arm masks from existing poses. The cup is a style illustration, not a literal mapping of ingredient quantities or portfolio weights.

