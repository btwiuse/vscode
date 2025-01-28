FROM btwiuse/arch:vscode-base

COPY . /app

WORKDIR /app

RUN bash ./vscode-web-index/npm-install

RUN bash ./vscode-web-index/npm-build

CMD bash ./vscode-web-index/package
