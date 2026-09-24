# Anime4K (vendored)

Original GLSL shaders from [bloc97/Anime4K](https://github.com/bloc97/Anime4K)
(MIT, see `LICENSE`), commit recorded in `SOURCE`. They are **not** used at
runtime: `npm run anime4k` transpiles them into WGSL compute passes in
`src/media/render/enhance/anime4k/`, keeping every trained weight as is.
