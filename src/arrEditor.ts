import * as vscode from 'vscode';
import { Disposable, disposeAll } from './dispose';
import { getNonce } from './util';
import { deserializeArray, serializeArray, ArrEntry, ValueType, getValueType } from './fileFormats/archive/array';


interface WebviewArrEntry {
	type: '1' | '2' | '3' | '4';
	value: 'string';
};

const makeIntegerEntry = (value: ArrEntry) => {
	switch (typeof (value)) {
		case 'bigint': {
			return value;
		}
		case 'string': {
			const parsedValue = parseFloat(value);
			if (isNaN(parsedValue)) {
				return 0n;
			}
			return BigInt(Math.trunc(parsedValue));
		}
		case 'boolean': {
			return BigInt(value);
		}
		case 'number': {
			return BigInt(Math.trunc(value));
		}
		default: {
			throw new Error(`Unsupported type: ${typeof (value)}`);
		}
	}
};

const makeStringEntry = (value: ArrEntry) => {
	switch (typeof (value)) {
		case 'bigint': {
			return value.toString();
		}
		case 'string': {
			return value;
		}
		case 'boolean': {
			return value ? 'TRUE' : 'FALSE';
		}
		case 'number': {
			return value.toFixed(4);
		}
		default: {
			throw new Error(`Unsupported type: ${typeof (value)}`);
		}
	}
};

const makeBoolEntry = (value: ArrEntry) => {
	switch (typeof (value)) {
		case 'bigint': {
			return value === 0n;
		}
		case 'string': {
			return value == '1' || value.toUpperCase().trim() == 'TRUE';
		}
		case 'boolean': {
			return value;
		}
		case 'number': {
			return value === 0;
		}
		default: {
			throw new Error(`Unsupported type: ${typeof (value)}`);
		}
	}
};

const makeDoubleEntry = (value: ArrEntry) => {
	switch (typeof (value)) {
		case 'bigint': {
			return Number(value);
		}
		case 'string': {
			const parsedValue = parseFloat(value);
			if (isNaN(parsedValue)) {
				return 0;
			}
			return isNaN(parsedValue) ? 0 : parsedValue;
		}
		case 'boolean': {
			return Number(value);
		}
		case 'number': {
			return value;
		}
		default: {
			throw new Error(`Unsupported type: ${typeof (value)}`);
		}
	}
};

const convertEntry = (value: ArrEntry, targetType: ValueType) => {
	switch (targetType) {
		case ValueType.INTEGER: {
			return makeIntegerEntry(value);
		}
		case ValueType.STRING: {
			return makeStringEntry(value);
		}
		case ValueType.BOOL: {
			return makeBoolEntry(value);
		}
		case ValueType.DOUBLE: {
			return makeDoubleEntry(value);
		}
		default: {
			throw new Error(`Unknown ARR value type: ${typeof (targetType)}`);
		}
	}
};

/**
 * Define the document (the data model) used for paw draw files.
 */
class ArrDocument extends Disposable implements vscode.CustomDocument {

	static async create(
		uri: vscode.Uri,
		backupId: string | undefined,
	): Promise<ArrDocument | PromiseLike<ArrDocument>> {
		// If we have a backup, read that. Otherwise read the resource from the workspace
		const dataFile = typeof backupId === 'string' ? vscode.Uri.parse(backupId) : uri;
		const fileData = await ArrDocument.readFile(dataFile);
		return new ArrDocument(uri, fileData as Uint8Array<ArrayBuffer>);
	}

	private static async readFile(uri: vscode.Uri): Promise<Uint8Array> {
		if (uri.scheme === 'untitled') {
			return new Uint8Array();
		}
		return new Uint8Array(await vscode.workspace.fs.readFile(uri));
	}

	private readonly _uri: vscode.Uri;

	private _entries: ArrEntry[] = [];

	private constructor(
		uri: vscode.Uri,
		initialContent: Uint8Array<ArrayBuffer>,
	) {
		super();
		this._uri = uri;
		this._entries = deserializeArray(initialContent.buffer);
	}

	public get uri() { return this._uri; }
	public get entries(): WebviewArrEntry[] {
		return this._entries.map(e => ({
			type: Number(getValueType(e)).toString(),
			value: makeStringEntry(e)
		} as WebviewArrEntry));
	}

	private readonly _onDidDispose = this._register(new vscode.EventEmitter<void>());
	/**
	 * Fired when the document is disposed of.
	 */
	public readonly onDidDispose = this._onDidDispose.event;

	private readonly _onDidChangeDocument = this._register(new vscode.EventEmitter<{
		readonly content?: Uint8Array;
		readonly entries: readonly WebviewArrEntry[];
	}>());
	/**
	 * Fired to notify webviews that the document has changed.
	 */
	public readonly onDidChangeContent = this._onDidChangeDocument.event;

	private readonly _onDidChange = this._register(new vscode.EventEmitter<{
		readonly label: string,
		undo(): void,
		redo(): void,
	}>());
	/**
	 * Fired to tell VS Code that an edit has occurred in the document.
	 *
	 * This updates the document's dirty indicator.
	 */
	public readonly onDidChange = this._onDidChange.event;

	/**
	 * Called by VS Code when there are no more references to the document.
	 *
	 * This happens when all editors for it have been closed.
	 */
	dispose(): void {
		this._onDidDispose.fire();
		super.dispose();
	}

	/**
	 * Called when the user edits the document in a webview.
	 *
	 * This fires an event to notify VS Code that the document has been edited.
	 */
	addEntry(type: ValueType) {
		const addedEntry = convertEntry('', type);
		this._entries.push(addedEntry);

		this._onDidChange.fire({
			label: 'Add entry',
			undo: async () => {
				this._entries.pop();
				this._onDidChangeDocument.fire({
					entries: this.entries,
				});
			},
			redo: async () => {
				this._entries.push(addedEntry);
				this._onDidChangeDocument.fire({
					entries: this.entries,
				});
			}
		});

		this._onDidChangeDocument.fire({
			entries: this.entries,
		});
	}

	setType(index: number, type: ValueType) {
		const backupValue = this._entries[index];
		if (type === getValueType(backupValue)) {
			return;
		}
		const modifiedValue = convertEntry(backupValue, type);
		this._entries[index] = modifiedValue;

		this._onDidChange.fire({
			label: 'Convert entry',
			undo: async () => {
				this._entries[index] = backupValue;
				this._onDidChangeDocument.fire({
					entries: this.entries,
				});
			},
			redo: async () => {
				this._entries[index] = modifiedValue;
				this._onDidChangeDocument.fire({
					entries: this.entries,
				});
			}
		});

		this._onDidChangeDocument.fire({
			entries: this.entries,
		});
	}

	setValue(index: number, value: string) {
		const backupValue = this._entries[index];
		const currentType = getValueType(backupValue);
		const modifiedValue = convertEntry(value, currentType);
		if (backupValue === modifiedValue && makeStringEntry(backupValue) === value) {
			return;
		}
		this._entries[index] = modifiedValue;

		this._onDidChange.fire({
			label: 'Set entry value',
			undo: async () => {
				this._entries[index] = backupValue;
				this._onDidChangeDocument.fire({
					entries: this.entries,
				});
			},
			redo: async () => {
				this._entries[index] = modifiedValue;
				this._onDidChangeDocument.fire({
					entries: this.entries,
				});
			}
		});

		this._onDidChangeDocument.fire({
			entries: this.entries,
		});
	}
	removeEntries(indices: number[]) {
		indices = indices.toSorted((a, b) => a - b);
		const backupEntries = indices.map(index => this._entries[index]);
		for (const index of indices.toReversed()) {
			this._entries.splice(index, 1);
		}

		this._onDidChange.fire({
			label: 'Remove entries',
			undo: async () => {
				for (let i = 0; i < indices.length; i++) {
					const index = indices[i];
					this._entries.splice(index, 0, backupEntries[i]);
				}
				this._onDidChangeDocument.fire({
					entries: this.entries,
				});
			},
			redo: async () => {
				for (const index of indices.toReversed()) {
					this._entries.splice(index, 1);
				}
				this._onDidChangeDocument.fire({
					entries: this.entries,
				});
			}
		});

		this._onDidChangeDocument.fire({
			entries: this.entries,
		});
	}
	clearEntries() {
		const backupEntries = this._entries;
		this._entries = [];

		this._onDidChange.fire({
			label: 'Clear entries',
			undo: async () => {
				this._entries = backupEntries;
				this._onDidChangeDocument.fire({
					entries: this.entries,
				});
			},
			redo: async () => {
				this._entries = [];
				this._onDidChangeDocument.fire({
					entries: this.entries,
				});
			}
		});

		this._onDidChangeDocument.fire({
			entries: this.entries,
		});
	}

	/**
	 * Called by VS Code when the user saves the document.
	 */
	async save(cancellation: vscode.CancellationToken): Promise<void> {
		await this.saveAs(this.uri, cancellation);
	}

	/**
	 * Called by VS Code when the user saves the document to a new location.
	 */
	async saveAs(targetResource: vscode.Uri, cancellation: vscode.CancellationToken): Promise<void> {
		console.log(this._entries);
		const fileData = serializeArray(this._entries);
		console.log(fileData);
		if (cancellation.isCancellationRequested) {
			return;
		}
		await vscode.workspace.fs.writeFile(targetResource, fileData);
	}

	/**
	 * Called by VS Code when the user calls `revert` on a document.
	 */
	async revert(_cancellation: vscode.CancellationToken): Promise<void> {
		const diskContent = await ArrDocument.readFile(this.uri);
		this._entries = deserializeArray(diskContent.buffer);
		this._onDidChangeDocument.fire({
			content: diskContent,
			entries: this.entries,
		});
	}

	/**
	 * Called by VS Code to backup the edited document.
	 *
	 * These backups are used to implement hot exit.
	 */
	async backup(destination: vscode.Uri, cancellation: vscode.CancellationToken): Promise<vscode.CustomDocumentBackup> {
		await this.saveAs(destination, cancellation);

		return {
			id: destination.toString(),
			delete: async () => {
				try {
					await vscode.workspace.fs.delete(destination);
				} catch {
					// noop
				}
			}
		};
	}
}

/**
 * Provider for ARR editors.
 *
 * ARR editors are used for `.arr` files which are used to store an array of typed data.
 *
 * This provider demonstrates:
 *
 * - How to implement a custom editor for binary files.
 * - Setting up the initial webview for a custom editor.
 * - Loading scripts and styles in a custom editor.
 * - Communication between VS Code and the custom editor.
 * - Using CustomDocuments to store information that is shared between multiple custom editors.
 * - Implementing save, undo, redo, and revert.
 * - Backing up a custom editor.
 */
export class ArrEditorProvider implements vscode.CustomEditorProvider<ArrDocument> {

	private static newArrFileId = 1;

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		vscode.commands.registerCommand('arrEditor.editor.new', () => {
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders) {
				vscode.window.showErrorMessage("Creating new ARR files currently requires opening a workspace");
				return;
			}

			const uri = vscode.Uri.joinPath(workspaceFolders[0].uri, `new-${ArrEditorProvider.newArrFileId++}.arr`)
				.with({ scheme: 'untitled' });

			vscode.commands.executeCommand('vscode.openWith', uri, ArrEditorProvider.viewType);
		});

		return vscode.window.registerCustomEditorProvider(
			ArrEditorProvider.viewType,
			new ArrEditorProvider(context),
			{
				// For this demo extension, we enable `retainContextWhenHidden` which keeps the
				// webview alive even when it is not visible. You should avoid using this setting
				// unless is absolutely required as it does have memory overhead.
				webviewOptions: {
					retainContextWhenHidden: true,
				},
				supportsMultipleEditorsPerDocument: false,
			});
	}

	private static readonly viewType = 'arrEditor.editor';

	/**
	 * Tracks all known webviews
	 */
	private readonly webviews = new WebviewCollection();

	constructor(
		private readonly _context: vscode.ExtensionContext
	) {
		vscode.commands.registerCommand('arrEditor.editor.deleteRow', () => {
			const { uri, viewType } = vscode.window.tabGroups.activeTabGroup.activeTab?.input as vscode.TabInputCustom;
			if (viewType !== 'arrEditor.editor') {
				return;
			}
			const panel = [...this.webviews.get(uri)].find(e => e.active);
			if (!panel) {
				console.log('No active webview panel found');
				return;
			}
			panel.webview.postMessage({
				type: 'context-remove'
			});
		});
		vscode.commands.registerCommand('arrEditor.editor.deleteAllRows', () => {
			const { uri, viewType } = vscode.window.tabGroups.activeTabGroup.activeTab?.input as vscode.TabInputCustom;
			if (viewType !== 'arrEditor.editor') {
				return;
			}
			const panel = [...this.webviews.get(uri)].find(e => e.active);
			if (!panel) {
				console.log('No active webview panel found');
				return;
			}
			panel.webview.postMessage({
				type: 'context-clear'
			});
		});
	}

	//#region CustomEditorProvider

	async openCustomDocument(
		uri: vscode.Uri,
		openContext: { backupId?: string },
		_token: vscode.CancellationToken
	): Promise<ArrDocument> {
		const document: ArrDocument = await ArrDocument.create(uri, openContext.backupId);

		const listeners: vscode.Disposable[] = [];

		listeners.push(document.onDidChange(e => {
			// Tell VS Code that the document has been edited by the use.
			this._onDidChangeCustomDocument.fire({
				document,
				...e,
			});
		}));

		listeners.push(document.onDidChangeContent(e => {
			// Update all webviews when the document changes
			for (const webviewPanel of this.webviews.get(document.uri)) {
				this.postMessage(webviewPanel, 'update', {
					entries: e.entries,
					content: e.content,
				});
			}
		}));

		document.onDidDispose(() => disposeAll(listeners));

		return document;
	}

	async resolveCustomEditor(
		document: ArrDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): Promise<void> {
		console.log('Resolving custom editor', webviewPanel);
		// Add the webview to our internal set of active webviews
		this.webviews.add(document.uri, webviewPanel);

		// Setup initial content for the webview
		webviewPanel.webview.options = {
			enableScripts: true,
		};
		webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

		webviewPanel.webview.onDidReceiveMessage(e => this.onMessage(document, e));

		// Wait for the webview to be properly ready before we init
		webviewPanel.webview.onDidReceiveMessage(e => {
			if (e.type === 'ready') {
				if (document.uri.scheme === 'untitled') {
					this.postMessage(webviewPanel, 'init', {
						untitled: true,
						editable: true,
						entries: [],
					});
				} else {
					const editable = vscode.workspace.fs.isWritableFileSystem(document.uri.scheme);

					this.postMessage(webviewPanel, 'init', {
						editable,
						entries: document.entries,
					});
				}
			}
		});
	}

	private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<ArrDocument>>();
	public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

	public saveCustomDocument(document: ArrDocument, cancellation: vscode.CancellationToken): Thenable<void> {
		return document.save(cancellation);
	}

	public saveCustomDocumentAs(document: ArrDocument, destination: vscode.Uri, cancellation: vscode.CancellationToken): Thenable<void> {
		return document.saveAs(destination, cancellation);
	}

	public revertCustomDocument(document: ArrDocument, cancellation: vscode.CancellationToken): Thenable<void> {
		return document.revert(cancellation);
	}

	public backupCustomDocument(document: ArrDocument, context: vscode.CustomDocumentBackupContext, cancellation: vscode.CancellationToken): Thenable<vscode.CustomDocumentBackup> {
		return document.backup(context.destination, cancellation);
	}

	//#endregion

	/**
	 * Get the static HTML used for in our editor's webviews.
	 */
	private getHtmlForWebview(webview: vscode.Webview): string {
		// Local path to script and css for the webview
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this._context.extensionUri, 'media', 'main.js'));

		const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this._context.extensionUri, 'media', 'reset.css'));

		const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this._context.extensionUri, 'media', 'vscode.css'));

		const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this._context.extensionUri, 'media', 'styles.css'));

		const tableUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this._context.extensionUri, 'node_modules', '@vscode-elements/elements-lite', 'components', 'table', 'table.css'));

		const labelUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this._context.extensionUri, 'node_modules', '@vscode-elements/elements-lite', 'components', 'label', 'label.css'));

		const selectUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this._context.extensionUri, 'node_modules', '@vscode-elements/elements-lite', 'components', 'select', 'select.css'));

		const textFieldUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this._context.extensionUri, 'node_modules', '@vscode-elements/elements-lite', 'components', 'textfield', 'textfield.css'));

		const buttonUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this._context.extensionUri, 'node_modules', '@vscode-elements/elements-lite', 'components', 'button', 'button.css'));


		// Use a nonce to whitelist which scripts can be run
		const nonce = getNonce();

		return /* html */`
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} blob:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link href="${styleResetUri}" rel="stylesheet" />
				<link href="${styleVSCodeUri}" rel="stylesheet" />
				<link href="${styleMainUri}" rel="stylesheet" />
				<link href="${tableUri}" rel="stylesheet" />
				<link href="${labelUri}" rel="stylesheet" />
				<link href="${selectUri}" rel="stylesheet" />
				<link href="${textFieldUri}" rel="stylesheet" />
				<link href="${buttonUri}" rel="stylesheet" />

				<title>ARR</title>
			</head>
			<body>
				<table id="arr-table-main" class="vscode-table">
					<thead>
						<tr>
							<th>Index</th>
							<th>Type</th>
							<th>Value</th>
						</tr>
					</thead>
					<tbody></tbody>
					<tfoot>
						<tr>
							<td></td>
							<td>
								<select class="vscode-select">
									<option value="1">INTEGER</option>
									<option value="2">STRING</option>
									<option value="3">BOOL</option>
									<option value="4">DOUBLE</option>
								</select>
							</td>
							<td>
								<button id="arr-button-add-entry" class="vscode-button">
									Add entry
								</button>
							</td>
						</tr>
					</tfoot>
				</table>

				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
	}

	private postMessage(panel: vscode.WebviewPanel, type: string, body: any): void {
		panel.webview.postMessage({ type, body });
	}

	private onMessage(document: ArrDocument, message: any) {
		switch (message.type) {
			case 'add-entry': {
				document.addEntry(Number(message.data.type));
				return;
			}
			case 'set-type': {
				document.setType(message.data.index, Number(message.data.type));
				return;
			}
			case 'set-value': {
				document.setValue(message.data.index, message.data.value);
				return;
			}
			case 'remove-entries': {
				document.removeEntries(message.data.indices);
				return;
			}
			case 'clear-entries': {
				document.clearEntries();
				return;
			}
		}
	}
}

/**
 * Tracks all webviews.
 */
class WebviewCollection {

	private readonly _webviews = new Set<{
		readonly resource: string;
		readonly webviewPanel: vscode.WebviewPanel;
	}>();

	/**
	 * Get all known webviews for a given uri.
	 */
	public *get(uri: vscode.Uri): Iterable<vscode.WebviewPanel> {
		const key = uri.toString();
		for (const entry of this._webviews) {
			if (entry.resource === key) {
				yield entry.webviewPanel;
			}
		}
	}

	/**
	 * Add a new webview to the collection.
	 */
	public add(uri: vscode.Uri, webviewPanel: vscode.WebviewPanel) {
		const entry = { resource: uri.toString(), webviewPanel };
		this._webviews.add(entry);

		webviewPanel.onDidDispose(() => {
			this._webviews.delete(entry);
		});
	}
}
