FROM btwiuse/arch:vscode-base

RUN git clone --depth=3 https://github.com/btwiuse/vscode -b vscode-web-index /app

WORKDIR /app

RUN bash ./vscode-web-index/npm-install

RUN bash ./vscode-web-index/npm-build

CMD bash ./vscode-web-index/package
