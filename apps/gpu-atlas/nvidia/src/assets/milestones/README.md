# Milestone resource banner scenery

`library-chip-macro.webp` is an original decorative Three.js render, 2200 × 600 pixels.
It depicts a generic GPU ATLAS package on a populated circuit board. It is an
illustration, not a reconstruction or photograph of an NVIDIA product or die.

The scene contains a layered ceramic carrier, rounded metal spreader, brushed
surface bump texture, a restrained GPU ATLAS marking, edge contacts, small SMD
components, circuit traces, studio environment reflections and soft shadows.
Its left side fades into #091114 for accessible live HTML content.

Use as an empty-alt decorative image with object-fit: cover and centered
position in a 1266 × 232 banner. The composition has been checked at that crop.

Regenerate from the project root while Vite is serving on 127.0.0.1:5173:

    node src/assets/milestones/render-scenery.mjs

Requirements: the project's Three.js and Playwright packages, Chrome, Python
and Pillow. Seeded textures make regeneration repeatable.
