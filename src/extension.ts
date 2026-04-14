import * as vscode from 'vscode';
import { FalkorDBManager } from './falkordb';

let falkorDBManager: FalkorDBManager;

export function activate(context: vscode.ExtensionContext) {
    console.log('ANFS Extension is now active!');

    // Initialize Status Bar UI
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(statusBarItem);

    // Initialize Connection Manager
    falkorDBManager = new FalkorDBManager(statusBarItem);
    falkorDBManager.connect();

    // Register a basic command
    const disposable = vscode.commands.registerCommand('anfs.status', () => {
        vscode.window.showInformationMessage('ANFS status check initiated.');
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {
    if (falkorDBManager) {
        falkorDBManager.dispose();
    }
}
