import * as vscode from 'vscode';
import { ArrEditorProvider } from './arrEditor';

export function activate(context: vscode.ExtensionContext) {
	// Register our custom editor providers
	context.subscriptions.push(ArrEditorProvider.register(context));
}
