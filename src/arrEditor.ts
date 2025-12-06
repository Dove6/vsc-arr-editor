import * as vscode from 'vscode';
import { Disposable, disposeAll } from './dispose';
import { getNonce } from './util';
import { deserializeArray, serializeArray } from 'reksio-formats/archive/array';

type ArrEntry = ArrEntryInt | ArrEntryString | ArrEntryBool | ArrEntryDouble;

interface ArrEntryInt {
	type: 'int',
	value: number,
}

interface ArrEntryString {
	type: 'string',
	value: string,
}

interface ArrEntryBool {
	type: 'bool',
	value: boolean,
}

interface ArrEntryDouble {
	type: 'double',
	value: number,
}

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
	private _savedEntries: ArrEntry[] = [];

	private constructor(
		uri: vscode.Uri,
		initialContent: Uint8Array<ArrayBuffer>,
	) {
		super();
		this._uri = uri;
		this._entries = this.deserializeEntries(initialContent.buffer);
		this._savedEntries = [...this._entries];
	}

	private deserializeEntries(buffer: ArrayBuffer): ArrEntry[] {
		return deserializeArray(buffer).map(e => {
			switch (typeof e) {
				case 'string': return { type: 'string', value: e };
				case 'boolean': return { type: 'bool', value: e };
				case 'number': return Number.isInteger(e) ? { type: 'int', value: e } : { type: 'double', value: e };
			}
		});
	}

	public get uri() { return this._uri; }
	public get entries(): ArrEntry[] { return this._entries; }

	private readonly _onDidDispose = this._register(new vscode.EventEmitter<void>());
	/**
	 * Fired when the document is disposed of.
	 */
	public readonly onDidDispose = this._onDidDispose.event;

	private readonly _onDidChangeDocument = this._register(new vscode.EventEmitter<{
		readonly content?: Uint8Array;
		readonly entries: readonly ArrEntry[];
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
	addEntry(entry: ArrEntry) {
		this._entries.push(entry);

		this._onDidChange.fire({
			label: 'Add entry',
			undo: async () => {
				this._entries.pop();
				this._onDidChangeDocument.fire({
					entries: this._entries,
				});
			},
			redo: async () => {
				this._entries.push(entry);
				this._onDidChangeDocument.fire({
					entries: this._entries,
				});
			}
		});

		this._onDidChangeDocument.fire({
			entries: this._entries,
		});
	}

	/**
	 * Called by VS Code when the user saves the document.
	 */
	async save(cancellation: vscode.CancellationToken): Promise<void> {
		await this.saveAs(this.uri, cancellation);
		this._savedEntries = [...this._entries];
	}

	/**
	 * Called by VS Code when the user saves the document to a new location.
	 */
	async saveAs(targetResource: vscode.Uri, cancellation: vscode.CancellationToken): Promise<void> {
		console.log(this._entries);
		const fileData = new Uint8Array(serializeArray(this._entries));
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
		this._entries = this.deserializeEntries(diskContent.buffer as ArrayBuffer);
		this._savedEntries = [...this._entries];
		this._onDidChangeDocument.fire({
			content: diskContent,
			entries: this._entries,
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
	) { }

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
							<td></td>
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

	private readonly _callbacks = new Map<number, (response: any) => void>();

	private postMessage(panel: vscode.WebviewPanel, type: string, body: any): void {
		panel.webview.postMessage({ type, body });
	}

	private onMessage(document: ArrDocument, message: any) {
		switch (message.type) {
			case 'add-entry': {
				document.addEntry(message.data as ArrEntry);
				return;
			}
			case 'response':{
				const callback = this._callbacks.get(message.requestId);
				callback?.(message.body);
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
