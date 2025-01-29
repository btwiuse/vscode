FROM btwiuse/arch:vscode-base

COPY . /app

WORKDIR /app

RUN bash ./vscode-reh/npm-install

RUN bash ./vscode-reh/npm-build

CMD bash ./vscode-reh/start
