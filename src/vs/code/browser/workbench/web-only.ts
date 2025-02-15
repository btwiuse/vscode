/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isStandalone } from '../../../base/browser/browser.js';
import { mainWindow } from '../../../base/browser/window.js';
import { Emitter } from '../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../base/common/lifecycle.js';
import { parse } from '../../../base/common/marshalling.js';
import { Schemas } from '../../../base/common/network.js';
import { posix } from '../../../base/common/path.js';
import { isEqual } from '../../../base/common/resources.js';
import { ltrim } from '../../../base/common/strings.js';
import { URI, UriComponents } from '../../../base/common/uri.js';
import product from '../../../platform/product/common/product.js';
import { ISecretStorageProvider } from '../../../platform/secrets/common/secrets.js';
import { isFolderToOpen, isWorkspaceToOpen } from '../../../platform/window/common/window.js';
import type { IWorkbenchConstructionOptions, IWorkspace, IWorkspaceProvider } from '../../../workbench/browser/web.api.js';
import { AuthenticationSessionInfo } from '../../../workbench/services/authentication/browser/authenticationService.js';
import type { IURLCallbackProvider } from '../../../workbench/services/url/browser/urlService.js';
import { create } from '../../../workbench/workbench.web.main.internal.js';
import { ICommand, Menu } from '../../../workbench/browser/web.api.js';

interface ISecretStorageCrypto {
	seal(data: string): Promise<string>;
	unseal(data: string): Promise<string>;
}

class TransparentCrypto implements ISecretStorageCrypto {
	async seal(data: string): Promise<string> {
		return data;
	}

	async unseal(data: string): Promise<string> {
		return data;
	}
}

class NetworkError extends Error {
	constructor(inner: Error) {
		super(inner.message);
		this.name = inner.name;
		this.stack = inner.stack;
	}
}

export class LocalStorageSecretStorageProvider implements ISecretStorageProvider {
	private readonly _storageKey = 'secrets.provider';

	private _secretsPromise: Promise<Record<string, string>> = this.load();

	type: 'in-memory' | 'persisted' | 'unknown' = 'persisted';

	constructor(
		private readonly crypto: ISecretStorageCrypto,
	) { }

	private async load(): Promise<Record<string, string>> {
		const record = this.loadAuthSessionFromElement();
		// Get the secrets from localStorage
		const encrypted = localStorage.getItem(this._storageKey);
		if (encrypted) {
			try {
				const decrypted = JSON.parse(await this.crypto.unseal(encrypted));
				return { ...record, ...decrypted };
			} catch (err) {
				// TODO: send telemetry
				console.error('Failed to decrypt secrets from localStorage', err);
				if (!(err instanceof NetworkError)) {
					localStorage.removeItem(this._storageKey);
				}
			}
		}

		return record;
	}

	private loadAuthSessionFromElement(): Record<string, string> {
		let authSessionInfo: (AuthenticationSessionInfo & { scopes: string[][] }) | undefined;
		const authSessionElement = mainWindow.document.getElementById('vscode-workbench-auth-session');
		const authSessionElementAttribute = authSessionElement ? authSessionElement.getAttribute('data-settings') : undefined;
		if (authSessionElementAttribute) {
			try {
				authSessionInfo = JSON.parse(authSessionElementAttribute);
			} catch (error) { /* Invalid session is passed. Ignore. */ }
		}

		if (!authSessionInfo) {
			return {};
		}

		const record: Record<string, string> = {};

		// Settings Sync Entry
		record[`${product.urlProtocol}.loginAccount`] = JSON.stringify(authSessionInfo);

		// Auth extension Entry
		if (authSessionInfo.providerId !== 'github') {
			console.error(`Unexpected auth provider: ${authSessionInfo.providerId}. Expected 'github'.`);
			return record;
		}

		const authAccount = JSON.stringify({ extensionId: 'vscode.github-authentication', key: 'github.auth' });
		record[authAccount] = JSON.stringify(authSessionInfo.scopes.map(scopes => ({
			id: authSessionInfo.id,
			scopes,
			accessToken: authSessionInfo.accessToken
		})));

		return record;
	}

	async get(key: string): Promise<string | undefined> {
		const secrets = await this._secretsPromise;
		return secrets[key];
	}
	async set(key: string, value: string): Promise<void> {
		const secrets = await this._secretsPromise;
		secrets[key] = value;
		this._secretsPromise = Promise.resolve(secrets);
		this.save();
	}
	async delete(key: string): Promise<void> {
		const secrets = await this._secretsPromise;
		delete secrets[key];
		this._secretsPromise = Promise.resolve(secrets);
		this.save();
	}

	private async save(): Promise<void> {
		try {
			const encrypted = await this.crypto.seal(JSON.stringify(await this._secretsPromise));
			localStorage.setItem(this._storageKey, encrypted);
		} catch (err) {
			console.error(err);
		}
	}
}


class LocalStorageURLCallbackProvider extends Disposable implements IURLCallbackProvider {

	private static REQUEST_ID = 0;

	private static QUERY_KEYS: ('scheme' | 'authority' | 'path' | 'query' | 'fragment')[] = [
		'scheme',
		'authority',
		'path',
		'query',
		'fragment'
	];

	private readonly _onCallback = this._register(new Emitter<URI>());
	readonly onCallback = this._onCallback.event;

	private pendingCallbacks = new Set<number>();
	private lastTimeChecked = Date.now();
	private checkCallbacksTimeout: unknown | undefined = undefined;
	private onDidChangeLocalStorageDisposable: IDisposable | undefined;

	constructor(private readonly _callbackRoute: string) {
		super();
	}

	create(options: Partial<UriComponents> = {}): URI {
		const id = ++LocalStorageURLCallbackProvider.REQUEST_ID;
		const queryParams: string[] = [`vscode-reqid=${id}`];

		for (const key of LocalStorageURLCallbackProvider.QUERY_KEYS) {
			const value = options[key];

			if (value) {
				queryParams.push(`vscode-${key}=${encodeURIComponent(value)}`);
			}
		}

		// TODO@joao remove eventually
		// https://github.com/microsoft/vscode-dev/issues/62
		// https://github.com/microsoft/vscode/blob/159479eb5ae451a66b5dac3c12d564f32f454796/extensions/github-authentication/src/githubServer.ts#L50-L50
		if (!(options.authority === 'vscode.github-authentication' && options.path === '/dummy')) {
			const key = `vscode-web.url-callbacks[${id}]`;
			localStorage.removeItem(key);

			this.pendingCallbacks.add(id);
			this.startListening();
		}

		return URI.parse(mainWindow.location.href).with({ path: this._callbackRoute, query: queryParams.join('&') });
	}

	private startListening(): void {
		if (this.onDidChangeLocalStorageDisposable) {
			return;
		}

		const fn = () => this.onDidChangeLocalStorage();
		mainWindow.addEventListener('storage', fn);
		this.onDidChangeLocalStorageDisposable = { dispose: () => mainWindow.removeEventListener('storage', fn) };
	}

	private stopListening(): void {
		this.onDidChangeLocalStorageDisposable?.dispose();
		this.onDidChangeLocalStorageDisposable = undefined;
	}

	// this fires every time local storage changes, but we
	// don't want to check more often than once a second
	private async onDidChangeLocalStorage(): Promise<void> {
		const ellapsed = Date.now() - this.lastTimeChecked;

		if (ellapsed > 1000) {
			this.checkCallbacks();
		} else if (this.checkCallbacksTimeout === undefined) {
			this.checkCallbacksTimeout = setTimeout(() => {
				this.checkCallbacksTimeout = undefined;
				this.checkCallbacks();
			}, 1000 - ellapsed);
		}
	}

	private checkCallbacks(): void {
		let pendingCallbacks: Set<number> | undefined;

		for (const id of this.pendingCallbacks) {
			const key = `vscode-web.url-callbacks[${id}]`;
			const result = localStorage.getItem(key);

			if (result !== null) {
				try {
					this._onCallback.fire(URI.revive(JSON.parse(result)));
				} catch (error) {
					console.error(error);
				}

				pendingCallbacks = pendingCallbacks ?? new Set(this.pendingCallbacks);
				pendingCallbacks.delete(id);
				localStorage.removeItem(key);
			}
		}

		if (pendingCallbacks) {
			this.pendingCallbacks = pendingCallbacks;

			if (this.pendingCallbacks.size === 0) {
				this.stopListening();
			}
		}

		this.lastTimeChecked = Date.now();
	}
}

function remoteAuthority(config: IWorkbenchConstructionOptions) {
   const url = new URL(document.location.href);
   const authority = url.searchParams.get('remoteAuthority') || config.remoteAuthority;
   return authority === null || authority === '' ? undefined : authority;
}

class WorkspaceProvider implements IWorkspaceProvider {

	private static QUERY_PARAM_EMPTY_WINDOW = 'ew';
	private static QUERY_PARAM_FOLDER = 'folder';
	private static QUERY_PARAM_WORKSPACE = 'workspace';

	private static QUERY_PARAM_PAYLOAD = 'payload';
	private static QUERY_PARAM_REMOTE_AUTHORITY = 'remoteAuthority';

	static create(config: IWorkbenchConstructionOptions & { folderUri?: UriComponents; workspaceUri?: UriComponents }) {
		let foundWorkspace = false;
		let workspace: IWorkspace;
		let payload = Object.create(null);

		const query = new URL(document.location.href).searchParams;
		query.forEach((value, key) => {
			switch (key) {
				// Folder
				case WorkspaceProvider.QUERY_PARAM_FOLDER:
					if (remoteAuthority(config) && value.startsWith(posix.sep)) {
						// when connected to a remote and having a value
						// that is a path (begins with a `/`), assume this
						// is a vscode-remote resource as simplified URL.
						workspace = { folderUri: URI.from({ scheme: Schemas.vscodeRemote, path: value, authority: remoteAuthority(config) }) };
					} else {
						workspace = { folderUri: URI.parse(value) };
					}
					foundWorkspace = true;
					break;

				// Workspace
				case WorkspaceProvider.QUERY_PARAM_WORKSPACE:
					if (remoteAuthority(config) && value.startsWith(posix.sep)) {
						// when connected to a remote and having a value
						// that is a path (begins with a `/`), assume this
						// is a vscode-remote resource as simplified URL.
						workspace = { workspaceUri: URI.from({ scheme: Schemas.vscodeRemote, path: value, authority: remoteAuthority(config) }) };
					} else {
						workspace = { workspaceUri: URI.parse(value) };
					}
					foundWorkspace = true;
					break;

				// Empty
				case WorkspaceProvider.QUERY_PARAM_EMPTY_WINDOW:
					workspace = undefined;
					foundWorkspace = true;
					break;

				// Payload
				case WorkspaceProvider.QUERY_PARAM_PAYLOAD:
					try {
						payload = parse(value); // use marshalling#parse() to revive potential URIs
					} catch (error) {
						console.error(error); // possible invalid JSON
					}
					break;
			}
		});

		// If no workspace is provided through the URL, check for config
		// attribute from server
		if (!foundWorkspace) {
			if (config.folderUri) {
				workspace = { folderUri: URI.revive(config.folderUri) };
			} else if (config.workspaceUri) {
				workspace = { workspaceUri: URI.revive(config.workspaceUri) };
			}
		}

		return new WorkspaceProvider(workspace, payload, config);
	}

	readonly trusted = true;

	private constructor(
		readonly workspace: IWorkspace,
		readonly payload: object,
		private readonly config: IWorkbenchConstructionOptions
	) {
	}

	async open(workspace: IWorkspace, options?: { reuse?: boolean; remoteAuthority?: string; payload?: object }): Promise<boolean> {
		console.log({workspace, options});
		if (options?.reuse && !options.payload && this.isSame(this.workspace, workspace) && options?.remoteAuthority === remoteAuthority(this.config)) {
			return true; // return early if workspace and environment is not changing and we are reusing window
		}

		const targetHref = this.createTargetUrl(workspace, options);
		if (targetHref) {
			if (options?.reuse) {
				mainWindow.location.href = targetHref;
				return true;
			} else {
				let result;
				if (isStandalone()) {
					result = mainWindow.open(targetHref, '_blank', 'toolbar=no'); // ensures to open another 'standalone' window!
				} else {
					result = mainWindow.open(targetHref);
				}

				return !!result;
			}
		}
		return false;
	}

	private createTargetUrl(workspace: IWorkspace, options?: { reuse?: boolean; remoteAuthority?: string; payload?: object }): string | undefined {

		// Empty
		let targetHref: string | undefined = undefined;
		if (!workspace) {
			if (options?.remoteAuthority) {
				targetHref = `${document.location.origin}${document.location.pathname}?${WorkspaceProvider.QUERY_PARAM_REMOTE_AUTHORITY}=${options?.remoteAuthority}`;
			} else {
				targetHref = `${document.location.origin}${document.location.pathname}?`;
			}
		}

		// Folder
		else if (isFolderToOpen(workspace)) {
			const queryParamFolder = this.encodeWorkspacePath(workspace.folderUri);
			targetHref = `${document.location.origin}${document.location.pathname}?${WorkspaceProvider.QUERY_PARAM_FOLDER}=${queryParamFolder}`;
		}

		// Workspace
		else if (isWorkspaceToOpen(workspace)) {
			const queryParamWorkspace = this.encodeWorkspacePath(workspace.workspaceUri);
			targetHref = `${document.location.origin}${document.location.pathname}?${WorkspaceProvider.QUERY_PARAM_WORKSPACE}=${queryParamWorkspace}`;
		}

		// Append payload if any
		if (options?.payload) {
			targetHref += `&${WorkspaceProvider.QUERY_PARAM_PAYLOAD}=${encodeURIComponent(JSON.stringify(options.payload))}`;
		}

		// Append remote authority if any
		if (remoteAuthority(this.config) && !options?.remoteAuthority) {
			targetHref += `&${WorkspaceProvider.QUERY_PARAM_REMOTE_AUTHORITY}=${remoteAuthority(this.config)}`;
		}

		return targetHref;
	}

	private encodeWorkspacePath(uri: URI): string {
		if (remoteAuthority(this.config) && uri.scheme === Schemas.vscodeRemote) {

			// when connected to a remote and having a folder
			// or workspace for that remote, only use the path
			// as query value to form shorter, nicer URLs.
			// however, we still need to `encodeURIComponent`
			// to ensure to preserve special characters, such
			// as `+` in the path.

			return encodeURIComponent(`${posix.sep}${ltrim(uri.path, posix.sep)}`).replaceAll('%2F', '/');
		}

		return encodeURIComponent(uri.toString(true));
	}

	private isSame(workspaceA: IWorkspace, workspaceB: IWorkspace): boolean {
		if (!workspaceA || !workspaceB) {
			return workspaceA === workspaceB; // both empty
		}

		if (isFolderToOpen(workspaceA) && isFolderToOpen(workspaceB)) {
			return isEqual(workspaceA.folderUri, workspaceB.folderUri); // same workspace
		}

		if (isWorkspaceToOpen(workspaceA) && isWorkspaceToOpen(workspaceB)) {
			return isEqual(workspaceA.workspaceUri, workspaceB.workspaceUri); // same workspace
		}

		return false;
	}

	hasRemote(): boolean {
		if (this.workspace) {
			if (isFolderToOpen(this.workspace)) {
				return this.workspace.folderUri.scheme === Schemas.vscodeRemote;
			}

			if (isWorkspaceToOpen(this.workspace)) {
				return this.workspace.workspaceUri.scheme === Schemas.vscodeRemote;
			}
		}

		return true;
	}
}

export class Command implements ICommand {
    constructor(
        public readonly id: string,
        public readonly handler: (...args: any[]) => unknown,
        public readonly label?: string,
        public readonly menu: Menu | Menu[] = Menu.CommandPalette
    ) {}
}

// Example usage:
const myCommand: ICommand = new Command(
    'extension.myCommand',
    (...args: any[]) => {
        console.log('Number of arguments:', args.length);
        args.forEach((arg, index) => {
            console.log(`Argument ${index}:`, arg);
            console.log('Type:', typeof arg);
        });

        return args; // Returns all arguments
    },
    'My Command',
    [Menu.StatusBarWindowIndicatorMenu, Menu.CommandPalette]
);

const patchABE = (config: any) => {
	if (!config.additionalBuiltinExtensions) {
		config.additionalBuiltinExtensions = [];
	}
	config.additionalBuiltinExtensions = config.additionalBuiltinExtensions.map((extension: UriComponents) => {
		return {
			...extension,
			authority: window.location.host,
			scheme: window.location.protocol.replace(/:$/, ''),
		};
	});
	return config;
}

(async function () {

	// Find config by checking for DOM
	const response = await fetch('/workbench.json');
	if (!response.ok) {
		throw new Error(`Failed to fetch config: ${response.status} ${response.statusText}`);
	}

	const config: IWorkbenchConstructionOptions & { folderUri?: UriComponents; workspaceUri?: UriComponents; callbackRoute: string } = patchABE(await response.json());

	// Create workbench
	create(mainWindow.document.body, {
		...config,
		commands: [myCommand],
		windowIndicator: config.windowIndicator ?? { label: '$(remote)', tooltip: `${product.nameShort} Web` },
		settingsSyncOptions: config.settingsSyncOptions ? { enabled: config.settingsSyncOptions.enabled, } : undefined,
		workspaceProvider: WorkspaceProvider.create(config),
		urlCallbackProvider: new LocalStorageURLCallbackProvider(config.callbackRoute),
		secretStorageProvider: remoteAuthority(config)
			? undefined /* with a remote without embedder-preferred storage, store on the remote */
			: new LocalStorageSecretStorageProvider(new TransparentCrypto()),
		remoteAuthority: remoteAuthority(config),
	});
})();
