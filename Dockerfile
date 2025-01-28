FROM btwiuse/arch:vscode-base

RUN git clone --depth=3 https://github.com/btwiuse/vscode -b vscode-web-index /app

WORKDIR /app

RUN bash ./vscode-web-index/pnpm-install

RUN bash ./vscode-web-index/pnpm-build

CMD bash ./vscode-web-index/package
