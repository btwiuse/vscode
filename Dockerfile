FROM btwiuse/arch:vscode-reh-web-linux-x64-marketplace AS vscode-reh-web-linux-x64-marketplace
RUN ls -l /

FROM btwiuse/arch:vscode-reh-web-linux-x64-open-vsx AS vscode-reh-web-linux-x64-open-vsx
RUN ls -l /

FROM btwiuse/arch:vscode-reh-web-linux-x64 AS vscode-reh-web-linux-x64
RUN ls -l /

FROM btwiuse/arch:vscode-reh-linux-x64 AS vscode-reh-linux-x64
RUN ls -l /

FROM btwiuse/arch:vscode-web-min AS vscode-web-min
RUN ls -l /

FROM btwiuse/arch:vscode-web AS vscode-web
RUN ls -l /

FROM btwiuse/arch:vscode-src

COPY --from=vscode-reh-web-linux-x64-marketplace /vscode-reh-web-linux-x64 /vscode-reh-web-linux-x64-marketplace
COPY --from=vscode-reh-web-linux-x64-open-vsx /vscode-reh-web-linux-x64 /vscode-reh-web-linux-x64-open-vsx
COPY --from=vscode-reh-web-linux-x64 /vscode-reh-web-linux-x64 /vscode-reh-web-linux-x64
COPY --from=vscode-reh-linux-x64 /vscode-reh-linux-x64 /vscode-reh-linux-x64
COPY --from=vscode-web-min /vscode-web /vscode-web-min
COPY --from=vscode-web /vscode-web /vscode-web

CMD /vscode-reh-web-linux-x64-marketplace/bin/codium-server --install-extension saoudrizwan.claude-dev --start-server --without-connection-token --host 0.0.0.0 --port 8000
