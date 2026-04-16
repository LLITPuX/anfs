import * as vscode from 'vscode';
import { FalkorDBManager } from './falkordb';
import { syncFileChange, syncFileCreate, syncFileRename, syncFileDelete } from './sync';
import { ASTParser } from './ast';

export class FSWatcher {
    private falkorDBManager: FalkorDBManager;
    private workspacePath: string;
    private debounceTimeout: NodeJS.Timeout | null = null;
    private pendingChanges: Set<string> = new Set();
    private pendingCreates: Set<string> = new Set();
    private pendingDeletes: Set<string> = new Set();
    private pendingRenames: Map<string, string> = new Map();
    private astParser: ASTParser;

    constructor(falkorDBManager: FalkorDBManager, workspacePath: string, astParser: ASTParser) {
        this.falkorDBManager = falkorDBManager;
        this.workspacePath = workspacePath;
        this.astParser = astParser;
    }

    public register(context: vscode.ExtensionContext) {
        // Use FileSystemWatcher for robust background monitoring (git pulls, etc.)
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(this.workspacePath, '**/*')
        );

        context.subscriptions.push(
            watcher.onDidChange(uri => this.enqueueChange(uri.fsPath)),
            watcher.onDidCreate(uri => this.enqueueCreate(uri.fsPath)),
            watcher.onDidDelete(uri => this.enqueueDelete(uri.fsPath)),
            vscode.workspace.onDidRenameFiles(e => this.onRename(e)),
            // Keep onDidSave for snappy UI-driven updates
            vscode.workspace.onDidSaveTextDocument(doc => {
                if (doc.uri.scheme === 'file') this.enqueueChange(doc.uri.fsPath);
            }),
            watcher
        );
    }

    private enqueueChange(path: string) {
        this.pendingChanges.add(path);
        this.triggerDebounce();
    }

    private enqueueCreate(path: string) {
        this.pendingCreates.add(path);
        this.triggerDebounce();
    }

    private enqueueDelete(path: string) {
        this.pendingDeletes.add(path);
        this.triggerDebounce();
    }

    private onRename(e: vscode.FileRenameEvent) {
        e.files.forEach(file => {
            this.pendingRenames.set(file.oldUri.fsPath, file.newUri.fsPath);
        });
        this.triggerDebounce();
    }

    private triggerDebounce() {
        if (this.debounceTimeout) {
            clearTimeout(this.debounceTimeout);
        }
        // Reduced debounce for better UX, but long enough to batch rapid changes
        this.debounceTimeout = setTimeout(() => this.flush(), 1000);
    }

    public async asyncFlush() { // Wrapper for background execution
        await this.flush();
    }

    public async flush() {
        if (this.debounceTimeout) {
            clearTimeout(this.debounceTimeout);
            this.debounceTimeout = null;
        }

        const changes = Array.from(this.pendingChanges);
        const creates = Array.from(this.pendingCreates);
        const deletes = Array.from(this.pendingDeletes);
        const renames = Array.from(this.pendingRenames.entries());

        // Don't clear until we actually try to sync!
        // This allows retry if FalkorDB is not ready yet.
        const graphName = `${require('path').basename(this.workspacePath)}_code`;
        const graph = this.falkorDBManager.getGraph(graphName);

        if (!graph) {
            console.log('ANFS Watcher: Waiting for FalkorDB connection to flush changes...');
            // Keep pending items for next flush attempt
            return;
        }

        // Now clear, because we are processing them
        this.pendingChanges.clear();
        this.pendingCreates.clear();
        this.pendingDeletes.clear();
        this.pendingRenames.clear();

        try {
            let processedCount = 0;

            // Process Renames
            for (const [oldPath, newPath] of renames) {
                await syncFileRename(this.falkorDBManager, this.workspacePath, oldPath, newPath);
                processedCount++;
            }

            // Process Deletes
            if (deletes.length > 0) {
                await syncFileDelete(this.falkorDBManager, this.workspacePath, deletes);
                processedCount += deletes.length;
            }

            // Process Creates
            if (creates.length > 0) {
                await syncFileCreate(this.falkorDBManager, this.workspacePath, creates, this.astParser);
                processedCount += creates.length;
            }

            // Process Changes
            for (const filePath of changes) {
                await syncFileChange(this.falkorDBManager, this.workspacePath, filePath, this.astParser);
                processedCount++;
            }

            if (processedCount > 0) {
                // Silent Toast notification as requested
                vscode.window.showInformationMessage(`ANFS: Automatically synced ${processedCount} change(s) to graph.`);
            }
        } catch (err) {
            console.error('ANFS Watcher Flush Error:', err);
            // In case of error, we might have lost some progress since we cleared the sets.
            // But we don't want to re-add everything potentially causing infinite loops.
            // For now, simple error reporting.
        }
    }
}
