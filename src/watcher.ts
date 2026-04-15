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
        context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument((doc) => this.onSave(doc)),
            vscode.workspace.onDidCreateFiles((e) => this.onCreate(e)),
            vscode.workspace.onDidDeleteFiles((e) => this.onDelete(e)),
            vscode.workspace.onDidRenameFiles((e) => this.onRename(e))
        );
    }

    private onSave(doc: vscode.TextDocument) {
        if (doc.uri.scheme !== 'file') return;
        this.pendingChanges.add(doc.uri.fsPath);
        this.triggerDebounce();
    }

    private onCreate(e: vscode.FileCreateEvent) {
        e.files.forEach(file => this.pendingCreates.add(file.fsPath));
        this.triggerDebounce();
    }

    private onDelete(e: vscode.FileDeleteEvent) {
        e.files.forEach(file => this.pendingDeletes.add(file.fsPath));
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
        this.debounceTimeout = setTimeout(() => this.flush(), 2000);
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

        this.pendingChanges.clear();
        this.pendingCreates.clear();
        this.pendingDeletes.clear();
        this.pendingRenames.clear();

        // Process Renames first to maintain graph integrity
        for (const [oldPath, newPath] of renames) {
            await syncFileRename(this.falkorDBManager, this.workspacePath, oldPath, newPath);
        }

        // Process Deletes
        if (deletes.length > 0) {
            await syncFileDelete(this.falkorDBManager, this.workspacePath, deletes);
        }

        // Process Creates
        if (creates.length > 0) {
            await syncFileCreate(this.falkorDBManager, this.workspacePath, creates, this.astParser);
        }

        // Process Changes
        for (const filePath of changes) {
            await syncFileChange(this.falkorDBManager, this.workspacePath, filePath, this.astParser);
        }
    }
}
