FROM btwiuse/arch:vscode-base

COPY . /app

WORKDIR /app

CMD bash ./vscode-reh/start
