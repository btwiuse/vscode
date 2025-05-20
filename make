cp -v codigo.svg src/vs/workbench/browser/media/code-icon.svg

magick convert -background black -density 1200 -resize 512x512 codigo.svg ./resources/server/code-512-dark.png
magick convert -background black -density 1200 -resize 192x192 codigo.svg ./resources/server/code-192-dark.png
magick convert -background white -density 1200 -resize 512x512 codigo.svg ./resources/server/code-512-light.png
magick convert -background white -density 1200 -resize 192x192 codigo.svg ./resources/server/code-192-light.png
magick convert -background none -density 1200 -resize 32x32 codigo.svg ./resources/server/favicon.ico
magick convert -background white -density 1200 -resize 410x410 codigo.svg -gravity center -extent 512x512 ./resources/server/code-512-maskable.png
magick convert -background white -density 1200 -resize 154x154 codigo.svg -gravity center -extent 192x192 ./resources/server/code-192-maskable.png
