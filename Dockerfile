FROM btwiuse/arch:vscode-base

RUN git clone https://github.com/btwiuse/vscode -b vscode-web-index /app

WORKDIR /app

# RUN npm i --ignore-scripts && npm --prefix=build i --ignore-scripts
# RUN npm run gulp vscode-web-only

RUN corepack enable
RUN corepack prepare pnpm@latest --activate
RUN pnpm i --ignore-scripts && pnpm --prefix=build i --ignore-scripts
RUN pnpm run gulp vscode-web-only

CMD bash ./vscode-web-index/package
