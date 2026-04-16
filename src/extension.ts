import * as vscode from 'vscode';
import { FalkorDBManager } from './falkordb';
import { performSync } from './sync';
import { FSWatcher } from './watcher';
import { ASTParser } from './ast';

let falkorDBManager: FalkorDBManager;
let fsWatcher: FSWatcher | undefined;
const astParser = new ASTParser();

export function activate(context: vscode.ExtensionContext) {
    console.log('ANFS Extension is now active!');

    // Initialize Status Bar UI
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(statusBarItem);

    // Initialize Connection Manager
    falkorDBManager = new FalkorDBManager(statusBarItem);
    
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        const rootPath = workspaceFolders[0].uri.fsPath;
        
        // Initialize AST Parser early
        astParser.init(context.extensionPath);

        // Initialize and register FS Watcher immediately
        fsWatcher = new FSWatcher(falkorDBManager, rootPath, astParser);
        fsWatcher.register(context);

        // Connect and Trigger Initial Sync on success
        falkorDBManager.connect().then(async () => {
            // Trigger initial sync slightly to ensure VS Code UI is fully responsive
            setTimeout(() => {
                performSync(falkorDBManager, rootPath, astParser);
            }, 1000);
        });
    }

    const disposableStatus = vscode.commands.registerCommand('anfs.status', () => {
        vscode.window.showInformationMessage('ANFS status check initiated.');
    });

    const disposableSync = vscode.commands.registerCommand('anfs.fullSync', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const rootPath = workspaceFolders[0].uri.fsPath;
            await performSync(falkorDBManager, rootPath, astParser);
        } else {
            vscode.window.showWarningMessage('ANFS: No workspace folders found to sync.');
        }
    });

    context.subscriptions.push(disposableStatus, disposableSync);
}

export async function deactivate() {
    if (fsWatcher) {
        await fsWatcher.flush();
    }
    if (falkorDBManager) {
        falkorDBManager.dispose();
    }
}
