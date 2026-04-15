import * as vscode from 'vscode';
import { FalkorDBManager } from './falkordb';
import { performSync } from './sync';

let falkorDBManager: FalkorDBManager;

export function activate(context: vscode.ExtensionContext) {
    console.log('ANFS Extension is now active!');

    // Initialize Status Bar UI
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(statusBarItem);

    // Initialize Connection Manager
    falkorDBManager = new FalkorDBManager(statusBarItem);
    
    // Connect and Trigger Sync on success
    falkorDBManager.connect().then(() => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const rootPath = workspaceFolders[0].uri.fsPath;
            // Delaying sync slightly to ensure VS Code UI is fully responsive
            setTimeout(() => {
                performSync(falkorDBManager, rootPath);
            }, 1000);
        }
    });

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
