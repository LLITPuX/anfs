import { Redis } from 'ioredis';
import * as vscode from 'vscode';

export class FalkorDBManager {
    private client: Redis | null = null;
    private statusBarItem: vscode.StatusBarItem;

    constructor(statusBarItem: vscode.StatusBarItem) {
        this.statusBarItem = statusBarItem;
        this.updateStatus('🔴 Disconnected');
    }

    public connect() {
        this.updateStatus('⏳ Syncing');
        
        // Connect to localhost:6379 natively.
        this.client = new Redis({
            host: '127.0.0.1',
            port: 6379,
            retryStrategy: (times) => {
                const delay = Math.min(times * 1000, 5000);
                return delay;
            },
            maxRetriesPerRequest: null,
        });

        this.client.on('connect', () => {
            this.updateStatus('🟢 Connected');
            // We only show info message to debug connection originally, can be annoying in production.
            vscode.window.showInformationMessage('ANFS: Connected to FalkorDB');
        });

        this.client.on('error', (err) => {
            this.updateStatus('🔴 Disconnected');
            vscode.window.showErrorMessage(`ANFS: FalkorDB Connection Error: ${err.message}`);
        });

        this.client.on('close', () => {
            this.updateStatus('🔴 Disconnected');
        });
    }

    public dispose() {
        if (this.client) {
            this.client.quit();
        }
    }

    private updateStatus(text: string) {
        this.statusBarItem.text = `ANFS: ${text}`;
        this.statusBarItem.show();
    }
}
