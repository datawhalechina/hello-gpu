# Performance-page artwork

The eleven transparent product thumbnails are static studio renders of the
same reference-reconstructed PCIe hardware used by the immersive explorer:
`src/components/cinematic/generationHardware.js` and `hardwareModel.js`.
They are visual reconstructions, not NVIDIA CAD or product photography. The
Blackwell render uses the same closed-assembly board and bracket offsets as
`CinematicScene.jsx`; its central board is inside the enclosure.

The Tesla, Volta and Turing milestone images are decorative studio renders of
parallel shader work, matrix processing and ray intersections. Their repeated
geometry is illustrative and does not represent physical die layout or core
counts. All assets have transparent backgrounds and are loaded as static WebP
images, so this page does not create additional persistent WebGL contexts.

To regenerate, start the local Vite server at `127.0.0.1:5173`, then run
`node src/assets/performance/render-artwork.mjs`. Requires the project's
Playwright dependency, Chrome, and Python Pillow. The script renders at up to
720 × 480, crops transparent padding, converts to WebP, and removes intermediate
PNGs. Runtime components use only the resulting WebP files.
